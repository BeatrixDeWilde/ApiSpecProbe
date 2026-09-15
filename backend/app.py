"""ApiSpecProbe backend.

Given a Swagger 2.0 API spec, generate a set of *potentially malicious* probe
requests (injection, malformed input, boundary and auth-abuse cases) that a
client can execute against the live API to see whether the responses are the
well-behaved rejections a secure service should return.

For this demo the target is locked to the public Swagger Petstore. Generation is
pure logic (no outbound network), so it lives here and is covered by tests; the
browser performs the live spec fetch and the live request execution.
"""

from urllib.parse import quote

from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel

from petstore_spec import PETSTORE_HOST, PETSTORE_SPEC, PETSTORE_SPEC_URL

app = FastAPI(title="ApiSpecProbe")


# --- Attack catalogue -------------------------------------------------------
# Each entry: (category, payload, rationale, expected_statuses)
# expected_statuses is the set a well-behaved API *should* answer with. Anything
# else (a 2xx that accepts the payload, or a 5xx crash) is flagged as unexpected.

_NUMERIC_PATH_ATTACKS = [
    ("SQL Injection", "1 OR 1=1",
     "Boolean SQL clause injected where a numeric ID is expected.", [400, 404, 405, 422]),
    ("Negative Boundary", "-1",
     "Negative identifier probes boundary and unsigned-integer handling.", [400, 404, 422]),
    ("Integer Overflow", "99999999999999999999",
     "Value far beyond the 64-bit range probes overflow handling.", [400, 404, 422]),
    ("Type Confusion", "not-a-number",
     "Non-numeric value supplied where an integer is required.", [400, 404, 405, 422]),
]

_STRING_PATH_ATTACKS = [
    ("SQL Injection", "' OR '1'='1",
     "Classic SQL injection string breaking out of a WHERE clause.", [400, 404, 405, 422]),
    ("Cross-Site Scripting", "<script>alert(1)</script>",
     "Reflected-XSS payload to check output encoding.", [400, 404, 422]),
    ("Path Traversal", "../../../../etc/passwd",
     "Directory-traversal sequence probing for file disclosure.", [400, 404, 422]),
]

_QUERY_ATTACKS = [
    ("SQL Injection", "' OR '1'='1",
     "SQL injection string in a query-string value.", [400, 422]),
    ("Cross-Site Scripting", "<script>alert(1)</script>",
     "Reflected-XSS payload in a query-string value.", [400, 422]),
]

_AUTH_PAYLOAD = "' OR '1'='1"

_METHODS = {"get", "post", "put", "delete", "patch"}


def _base_url(spec):
    host = (spec.get("host") or PETSTORE_HOST)
    base_path = (spec.get("basePath") or "").rstrip("/")
    schemes = spec.get("schemes") or ["https"]
    scheme = "https" if "https" in schemes else schemes[0]
    return f"{scheme}://{host}{base_path}"


def _benign(param):
    return "1" if param.get("type") in ("integer", "number") else "sample"


def _fill_path(path, path_params, overrides):
    filled = path
    for pp in path_params:
        name = pp["name"]
        raw = overrides.get(name, _benign(pp))
        filled = filled.replace("{" + name + "}", quote(str(raw), safe=""))
    return filled


def _build_url(base, path, path_params, overrides=None, query=None):
    url = base + _fill_path(path, path_params, overrides or {})
    if query:
        name, value = query
        url += "?" + name + "=" + quote(str(value), safe="")
    return url


def _describe_statuses(statuses):
    return ", ".join(str(s) for s in statuses)


def _tests_for_operation(base, path, method, op):
    params = op.get("parameters", []) or []
    path_params = [p for p in params if p.get("in") == "path"]
    query_params = [p for p in params if p.get("in") == "query"]
    has_body = any(p.get("in") in ("body", "formData") for p in params)
    secured = bool(op.get("security"))
    opid = op.get("operationId") or f"{method}_{path}"
    summary = op.get("summary", "")
    method_u = method.upper()
    tests = []

    def add(category, payload, rationale, target, expected, url,
            headers=None, body=None):
        tests.append({
            "operationId": opid,
            "summary": summary,
            "name": f"{category} via {target}",
            "category": category,
            "rationale": rationale,
            "target": target,
            "payload": payload,
            "method": method_u,
            "path": path,
            "url": url,
            "headers": headers or {},
            "body": body,
            "expectedBehavior": f"Reject the probe with a client error ({_describe_statuses(expected)}).",
            "expectedStatuses": expected,
        })

    # --- Path-parameter injection (attack the first path param) ---
    if path_params:
        pp = path_params[0]
        attacks = (_NUMERIC_PATH_ATTACKS
                   if pp.get("type") in ("integer", "number")
                   else _STRING_PATH_ATTACKS)
        for category, payload, rationale, expected in attacks:
            url = _build_url(base, path, path_params, {pp["name"]: payload})
            add(category, payload, rationale, f"path `{pp['name']}`", expected, url)

    # --- Query-parameter injection (attack the first query param) ---
    real_query = [q for q in query_params if q.get("name")]
    if real_query:
        qp = real_query[0]
        for category, payload, rationale, expected in _QUERY_ATTACKS:
            url = _build_url(base, path, path_params, None, (qp["name"], payload))
            add(category, payload, rationale, f"query `{qp['name']}`", expected, url)

    # --- Request-body abuse ---
    if has_body and method in ("post", "put", "patch"):
        url = _build_url(base, path, path_params)
        headers = {"Content-Type": "application/json"}
        malformed = {"id": "not-an-integer", "name": ["array", "not", "string"],
                     "status": True, "quantity": -2147483648}
        add("Malformed Body", "type-confused JSON object",
            "Every field carries a wrong-typed value to test schema validation.",
            "request body", [400, 415, 422], url,
            headers=headers, body=malformed)
        oversized = {"name": "A" * 4096}
        add("Oversized Payload", "4 KB string field",
            "Large field probes length limits and buffer handling.",
            "request body", [400, 413, 422], url,
            headers=headers, body=oversized)

    # --- Authentication abuse ---
    if secured:
        url = _build_url(base, path, path_params)
        add("Auth Bypass", _AUTH_PAYLOAD,
            "Injection payload sent as the api_key header on a secured operation.",
            "api_key header", [401, 403], url,
            headers={"api_key": _AUTH_PAYLOAD})

    return tests


def generate_tests(spec):
    """Produce probe requests for a Swagger 2.0 spec. Locked to the demo host."""
    host = (spec.get("host") or "").lower()
    if host and host != PETSTORE_HOST:
        raise ValueError(
            f"This demo is locked to {PETSTORE_HOST}; refusing to target '{host}'."
        )
    base = _base_url(spec)
    tests = []
    for path, ops in (spec.get("paths") or {}).items():
        if not isinstance(ops, dict):
            continue
        for method, op in ops.items():
            if method.lower() not in _METHODS or not isinstance(op, dict):
                continue
            tests.extend(_tests_for_operation(base, path, method.lower(), op))
    for i, t in enumerate(tests):
        t["id"] = f"probe-{i}"
    return {"target": base, "count": len(tests), "tests": tests}


# --- API routes -------------------------------------------------------------

class SpecPayload(BaseModel):
    spec: dict


@app.get("/api/target")
async def target():
    """The locked demo target the frontend must load its spec from."""
    return {
        "host": PETSTORE_HOST,
        "specUrl": PETSTORE_SPEC_URL,
        "baseUrl": _base_url(PETSTORE_SPEC),
        "locked": True,
    }


@app.get("/api/spec")
async def bundled_spec():
    """Bundled Petstore spec, used as a fallback when the live fetch fails."""
    return PETSTORE_SPEC


@app.post("/api/generate")
async def generate(payload: SpecPayload):
    """Generate probe requests from an uploaded Swagger 2.0 spec."""
    try:
        return generate_tests(payload.spec)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/message")
async def message(request: Request, response: Response):
    # Cloudflare supplies this binding on the server; never send its value to React.
    env = request.scope.get("env")
    secret = getattr(env, "APP_SECRET", None) if env is not None else None
    if not secret:
        raise HTTPException(
            status_code=503,
            detail="APP_SECRET is not configured on the backend.",
            headers={"Cache-Control": "no-store"},
        )
    response.headers["Cache-Control"] = "no-store"
    return {
        "message": "Hello from FastAPI! The secret was read successfully.",
        "secret_loaded": True,
    }
