"""Generate potentially malicious probe requests from an OpenAPI spec via Gemini.

The Gemini API key is supplied by the caller; when the worker is hosted on
Cloudflare it comes from a Cloudflare secret binding (see routes.py). Outbound
HTTP uses the Workers runtime ``fetch`` in production and falls back to ``httpx``
for local development and tests. The transport can also be injected, which is how
the test suite exercises this module without a network call.

Nothing here is specific to any particular API: it operates purely on the spec it
is given.
"""

import asyncio
import json

from openapi import base_url, build_url

GEMINI_MODEL = "gemini-3.6-flash"
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"

# Fallback if the model omits the codes a secure API should answer a probe with.
DEFAULT_EXPECTED_STATUSES = [400, 401, 403, 404, 405, 415, 422]

# Response schema for Gemini structured output (its schema dialect uses uppercase
# type names and does not allow free-form objects, so name/value pairs are used).
_PAIR = {
    "type": "OBJECT",
    "properties": {"name": {"type": "STRING"}, "value": {"type": "STRING"}},
    "required": ["name", "value"],
}
RESPONSE_SCHEMA = {
    "type": "ARRAY",
    "items": {
        "type": "OBJECT",
        "properties": {
            "name": {"type": "STRING"},
            "category": {"type": "STRING"},
            "rationale": {"type": "STRING"},
            "target": {"type": "STRING"},
            "payload": {"type": "STRING"},
            "method": {"type": "STRING"},
            "path": {"type": "STRING"},
            "pathParams": {"type": "ARRAY", "items": _PAIR},
            "query": {"type": "ARRAY", "items": _PAIR},
            "headers": {"type": "ARRAY", "items": _PAIR},
            "body": {"type": "STRING"},
            "expectedStatuses": {"type": "ARRAY", "items": {"type": "INTEGER"}},
            "expectedBehavior": {"type": "STRING"},
            "sampleResponse": {
                "type": "OBJECT",
                "properties": {
                    "status": {"type": "INTEGER"},
                    "body": {"type": "STRING"},
                },
                "required": ["status"],
            },
        },
        "required": ["name", "category", "method", "path", "expectedStatuses"],
    },
}


class GeminiError(RuntimeError):
    """Raised when Gemini cannot be reached or returns an unusable response.

    ``retryable`` marks transient failures (5xx, network errors, unparseable
    output) that are worth trying again.
    """

    def __init__(self, message, *, retryable=False):
        super().__init__(message)
        self.retryable = retryable


def _endpoint(model):
    return f"{GEMINI_BASE}/models/{model}:generateContent"


def build_prompt(spec):
    return (
        "You are an API security testing assistant helping a developer probe THEIR OWN "
        "API for robustness. You are given an OpenAPI/Swagger specification. Generate a "
        "diverse set of potentially malicious or malformed HTTP requests that exercise the "
        "endpoints in the spec, to check whether the API rejects them the way a secure "
        "service should.\n\n"
        "Cover a range of attack classes wherever the endpoints allow, for example: SQL and "
        "NoSQL injection, cross-site scripting, path traversal, command injection, integer "
        "boundary and overflow values, type confusion, oversized payloads, malformed request "
        "bodies, and authentication or authorization abuse. Base every request on a real "
        "operation from the spec.\n\n"
        "For each request provide: a short name; the attack category; a one-sentence "
        "rationale; which part of the request you are attacking (target); the raw payload; the "
        "HTTP method; the operation path template exactly as in the spec (e.g. /pet/{petId}); "
        "the pathParams, query and headers to send as name/value pairs using RAW, UNENCODED "
        "values (the caller percent-encodes them); an optional request body as a string; the "
        "HTTP status codes a secure API SHOULD respond with (expectedStatuses, normally 4xx "
        "client errors); a short expectedBehavior; and a sampleResponse (a plausible HTTP "
        "status and short JSON body the real API might actually return to this probe) that is "
        "used as a cached fallback when the live request cannot be sent.\n\n"
        "Produce between 15 and 30 requests, spread across as many different endpoints as "
        "possible. Only reference paths, parameters and headers that exist in the spec.\n\n"
        f"OpenAPI specification:\n{json.dumps(spec)}"
    )


# --- transport -------------------------------------------------------------

try:  # Present only in the Cloudflare Python Workers runtime.
    import js  # noqa: F401
    from pyodide.ffi import to_js  # noqa: F401

    _IN_WORKERS = True
except Exception:  # pragma: no cover - depends on runtime
    _IN_WORKERS = False


def _decode(text):
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        raise GeminiError(
            f"Gemini returned a non-JSON response: {text[:300]}", retryable=True
        )


async def _default_post(url, headers, payload):
    """POST JSON and return the parsed JSON response.

    HTTP 5xx and transport/parse failures are raised as retryable errors.
    """
    if _IN_WORKERS:  # pragma: no cover - runs only on Cloudflare
        import js
        from js import Object
        from pyodide.ffi import to_js

        options = to_js(
            {"method": "POST", "headers": headers, "body": json.dumps(payload)},
            dict_converter=Object.fromEntries,
        )
        try:
            response = await js.fetch(url, options)
            text = await response.text()
            status = response.status
        except Exception as exc:  # network / runtime failure
            raise GeminiError(f"Could not reach Gemini: {exc}", retryable=True)
        if status >= 400:
            raise GeminiError(
                f"Gemini API error {status}: {text[:300]}", retryable=status >= 500
            )
        return _decode(text)

    import httpx

    try:
        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.post(url, headers=headers, json=payload)
    except httpx.RequestError as exc:
        raise GeminiError(f"Could not reach Gemini: {exc}", retryable=True)
    if response.status_code >= 400:
        raise GeminiError(
            f"Gemini API error {response.status_code}: {response.text[:300]}",
            retryable=response.status_code >= 500,
        )
    return _decode(response.text)


# --- parsing + normalisation ----------------------------------------------

def _pairs(value):
    """Normalise headers/query/pathParams into a list of (name, value) tuples."""
    if not value:
        return []
    if isinstance(value, dict):
        return [(str(k), str(v)) for k, v in value.items()]
    out = []
    for item in value:
        if isinstance(item, dict) and "name" in item:
            out.append((str(item["name"]), str(item.get("value", ""))))
    return out


def _statuses(value):
    out = []
    for s in value or []:
        try:
            out.append(int(s))
        except (TypeError, ValueError):
            continue
    return out or list(DEFAULT_EXPECTED_STATUSES)


def _normalize(base, index, item):
    method = str(item.get("method", "GET")).upper()
    path = item.get("path", "") or ""
    path_params = _pairs(item.get("pathParams"))
    query = _pairs(item.get("query"))
    headers = {name: value for name, value in _pairs(item.get("headers"))}
    body = item.get("body") or None
    statuses = _statuses(item.get("expectedStatuses"))
    sample = item.get("sampleResponse") or {}
    try:
        sample_status = int(sample.get("status"))
    except (TypeError, ValueError):
        sample_status = statuses[0]
    return {
        "id": f"probe-{index}",
        "name": item.get("name") or f"{method} {path}",
        "category": item.get("category") or "Uncategorized",
        "rationale": item.get("rationale") or "",
        "target": item.get("target") or "",
        "payload": item.get("payload") or "",
        "method": method,
        "path": path,
        "url": build_url(base, path, path_params, query),
        "headers": headers,
        "body": body,
        "expectedStatuses": statuses,
        "expectedBehavior": item.get("expectedBehavior")
        or f"Reject the probe with a client error ({', '.join(map(str, statuses))}).",
        # Gemini's best guess of a real response, cached for the demo fallback.
        "cachedResponse": {
            "status": sample_status,
            "statusText": "",
            "body": sample.get("body") or "",
            "source": "gemini",
        },
    }


def _parse_items(data):
    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError):
        feedback = data.get("promptFeedback") if isinstance(data, dict) else None
        raise GeminiError(f"Gemini returned no usable candidates. {feedback or ''}".strip())
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise GeminiError(f"Could not parse Gemini output as JSON: {exc}", retryable=True)
    if isinstance(parsed, dict):
        parsed = parsed.get("requests") or parsed.get("tests") or []
    if not isinstance(parsed, list):
        raise GeminiError("Gemini output was not a JSON array of requests.", retryable=True)
    return parsed


# --- public API ------------------------------------------------------------

async def generate_requests(spec, api_key, *, post=None, model=GEMINI_MODEL,
                            retries=1, backoff=0.6):
    """Ask Gemini for probe requests derived from ``spec``.

    ``post`` is an async ``(url, headers, payload) -> dict`` transport; the
    default talks to the real Gemini API. ``api_key`` authenticates the request.
    Transient failures (5xx, network errors, unparseable output) are retried up
    to ``retries`` times before giving up.
    """
    if not isinstance(spec, dict) or not spec.get("paths"):
        raise ValueError("The uploaded document does not look like an OpenAPI spec.")

    transport = post or _default_post
    base = base_url(spec)
    payload = {
        "contents": [{"role": "user", "parts": [{"text": build_prompt(spec)}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": RESPONSE_SCHEMA,
            "temperature": 0.9,
        },
    }
    headers = {"Content-Type": "application/json", "x-goog-api-key": api_key}

    attempt = 0
    while True:
        try:
            data = await transport(_endpoint(model), headers, payload)
            items = _parse_items(data)
            break
        except GeminiError as exc:
            if not exc.retryable or attempt >= retries:
                raise
            attempt += 1
            if backoff:
                await asyncio.sleep(backoff * attempt)
    tests = [_normalize(base, i, item) for i, item in enumerate(items)]
    return {"target": base, "count": len(tests), "tests": tests}
