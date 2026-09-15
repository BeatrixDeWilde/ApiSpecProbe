"""Local ASGI entrypoint; Cloudflare continues to use entry.py."""
import os
from pathlib import Path
from types import SimpleNamespace

from dotenv import dotenv_values
from app import app as fastapi_app

DEV_VARS = Path(__file__).resolve().parent.parent / ".dev.vars"

async def app(scope, receive, send):
    values = dotenv_values(DEV_VARS)
    scope = dict(scope)
    scope["env"] = SimpleNamespace(
        APP_SECRET=values.get("APP_SECRET") or os.getenv("APP_SECRET"),
        GEMINI_API_KEY=values.get("GEMINI_API_KEY") or os.getenv("GEMINI_API_KEY"),
    )
    await fastapi_app(scope, receive, send)
