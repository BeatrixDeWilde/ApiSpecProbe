from types import SimpleNamespace

from fastapi.testclient import TestClient
from backend.app import app


def client_with_secret(secret):
    async def with_env(scope, receive, send):
        scope["env"] = SimpleNamespace(APP_SECRET=secret)
        await app(scope, receive, send)
    return TestClient(with_env)


def test_secret_is_read_but_never_returned():
    response = client_with_secret("test-private-value").get("/api/message")
    assert response.status_code == 200
    assert response.json()["secret_loaded"] is True
    assert "test-private-value" not in response.text
    assert response.headers["cache-control"] == "no-store"


def test_missing_secret():
    response = client_with_secret("").get("/api/message")
    assert response.status_code == 503
    assert response.headers["cache-control"] == "no-store"


def test_unknown_api_route():
    assert client_with_secret("test-value").get("/api/unknown").status_code == 404
