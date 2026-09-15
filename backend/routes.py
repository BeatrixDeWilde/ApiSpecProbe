"""HTTP routes for the ApiSpecProbe backend.

Route handlers only: spec/request-generation logic lives in ``gemini.py`` and
``openapi.py``, and the demo spec that gets loaded lives in ``demo_spec.py``.
"""

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

import time

import gemini
import http_client
from cached import CACHED_RESULT
from demo_spec import DEMO_SPEC, DEMO_SPEC_URL
from openapi import base_url

router = APIRouter()


class SpecPayload(BaseModel):
    spec: dict


class ExecutePayload(BaseModel):
    method: str = "GET"
    url: str
    headers: dict = {}
    body: str | None = None


def _secret(request: Request, name: str):
    """Read a Cloudflare secret binding supplied on the server-side env."""
    env = request.scope.get("env")
    return getattr(env, name, None) if env is not None else None


@router.get("/api/target")
async def target():
    """The spec the demo loads, plus the base URL derived from it."""
    return {"specUrl": DEMO_SPEC_URL, "baseUrl": base_url(DEMO_SPEC)}


@router.get("/api/spec")
async def spec():
    """Bundled demo spec, used as a fallback when the live fetch fails."""
    return DEMO_SPEC


@router.get("/api/cached")
async def cached():
    """Cached probe requests (with sample responses) for the demo fallback."""
    return CACHED_RESULT


@router.post("/api/generate")
async def generate(payload: SpecPayload, request: Request):
    """Generate probe requests from an uploaded spec using Gemini."""
    api_key = _secret(request, "GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="GEMINI_API_KEY is not configured on the backend.",
            headers={"Cache-Control": "no-store"},
        )
    try:
        return await gemini.generate_requests(payload.spec, api_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except gemini.GeminiError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except Exception as exc:  # never leak a raw non-JSON 500 to the client
        raise HTTPException(status_code=502, detail=f"Request generation failed: {exc}")


@router.post("/api/execute")
async def execute(payload: ExecutePayload):
    """Send a generated probe request server-side and return the response.

    Executing from the backend (rather than the browser) avoids CORS limits and
    keeps the client from making cross-origin calls itself. Only http(s) URLs are
    allowed.
    """
    if not payload.url.lower().startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Only http(s) URLs can be executed.")
    headers = {str(k): str(v) for k, v in (payload.headers or {}).items()}
    started = time.monotonic()
    try:
        status, status_text, text = await http_client.fetch_text(
            payload.method, payload.url, headers, payload.body
        )
    except http_client.HttpError as exc:
        raise HTTPException(status_code=502, detail=f"Could not send request: {exc}")
    return {
        "status": status,
        "statusText": status_text,
        "body": text,
        "elapsedMs": int((time.monotonic() - started) * 1000),
    }