"""Generic helpers for working with an OpenAPI / Swagger specification.

Nothing here is tied to a particular API — these functions work for any Swagger
2.0 or OpenAPI 3 document that is loaded into the tool.
"""

from urllib.parse import quote


def base_url(spec):
    """Derive the base URL requests should target from a spec.

    Supports OpenAPI 3 (``servers``) and Swagger 2.0 (``host`` + ``basePath`` +
    ``schemes``). Returns an empty string if the spec does not declare one.
    """
    servers = spec.get("servers")
    if isinstance(servers, list) and servers and isinstance(servers[0], dict):
        url = servers[0].get("url")
        if url:
            return url.rstrip("/")

    host = spec.get("host")
    if host:
        base_path = (spec.get("basePath") or "").rstrip("/")
        schemes = spec.get("schemes") or ["https"]
        scheme = "https" if "https" in schemes else schemes[0]
        return f"{scheme}://{host}{base_path}"

    return ""


def build_url(base, path, path_params=None, query=None):
    """Assemble a request URL from a path template and raw parameter values.

    Path/query values are percent-encoded here so callers (and the model that
    proposes them) can work with raw, unencoded payloads.
    """
    filled = path or ""
    for name, value in (path_params or []):
        filled = filled.replace("{" + name + "}", quote(str(value), safe=""))

    url = base.rstrip("/") + "/" + filled.lstrip("/") if base else filled

    pairs = list(query or [])
    if pairs:
        qs = "&".join(f"{quote(str(n))}={quote(str(v), safe='')}" for n, v in pairs)
        url += ("&" if "?" in url else "?") + qs
    return url
