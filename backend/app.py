"""ApiSpecProbe backend application.

Loads an OpenAPI/Swagger spec, uses Gemini to generate potentially malicious
probe requests from it, and lets a client execute them against the live API to
see whether the responses are the well-behaved rejections a secure service
should return.

This module only wires the app together; routes live in ``routes.py``.
"""

from fastapi import FastAPI

from routes import router

app = FastAPI(title="ApiSpecProbe")
app.include_router(router)
