from fastapi import FastAPI, HTTPException, Request, Response

app = FastAPI(title="ApiSpecProbe")


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
