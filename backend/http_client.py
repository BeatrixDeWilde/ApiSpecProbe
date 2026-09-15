"""Server-side HTTP transport.

Performs outbound HTTP requests from the backend, using the Cloudflare Workers
runtime ``fetch`` in production and ``httpx`` for local development and tests.
Both the Gemini client and the live probe-execution route use this so the
send-from-the-backend logic lives in one place.
"""

import json

try:  # Present only in the Cloudflare Python Workers runtime.
    import js  # noqa: F401
    from pyodide.ffi import to_js  # noqa: F401

    _IN_WORKERS = True
except Exception:  # pragma: no cover - depends on runtime
    _IN_WORKERS = False


class HttpError(RuntimeError):
    """A request could not be sent (network / runtime failure)."""

    def __init__(self, message, *, retryable=False):
        super().__init__(message)
        self.retryable = retryable


async def fetch_text(method, url, headers=None, body=None, timeout=45):
    """Send a request and return ``(status, status_text, text)``.

    ``body`` is a string (already-serialised) or ``None``. Raises ``HttpError``
    only when the request cannot be sent; an HTTP error *status* is returned
    normally so callers can inspect it.
    """
    method = (method or "GET").upper()
    headers = headers or {}

    if _IN_WORKERS:  # pragma: no cover - runs only on Cloudflare
        import js
        from js import Object
        from pyodide.ffi import to_js

        opts = {"method": method, "headers": headers}
        if body is not None:
            opts["body"] = body
        options = to_js(opts, dict_converter=Object.fromEntries)
        try:
            response = await js.fetch(url, options)
            text = await response.text()
            return response.status, response.statusText, text
        except Exception as exc:
            raise HttpError(f"Request failed: {exc}", retryable=True)

    import httpx

    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            response = await client.request(method, url, headers=headers, content=body)
        return response.status_code, response.reason_phrase, response.text
    except httpx.RequestError as exc:
        raise HttpError(f"Request failed: {exc}", retryable=True)


async def post_json(url, headers, payload):
    """POST a JSON payload and return the parsed JSON response.

    Raises ``HttpError`` on transport failure, HTTP error status, or an
    unparseable body.
    """
    status, _, text = await fetch_text("POST", url, headers, json.dumps(payload))
    if status >= 400:
        raise HttpError(f"HTTP {status}: {text[:300]}", retryable=status >= 500)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        raise HttpError(f"Non-JSON response: {text[:300]}", retryable=True)
