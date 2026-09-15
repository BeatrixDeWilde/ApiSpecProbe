from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend.app import app, generate_tests
from backend.petstore_spec import PETSTORE_HOST, PETSTORE_SPEC


def client_with_secret(secret):
    async def with_env(scope, receive, send):
        scope["env"] = SimpleNamespace(APP_SECRET=secret)
        await app(scope, receive, send)
    return TestClient(with_env)


client = TestClient(app)


# --- existing secret-integration behaviour ---------------------------------

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


# --- locked target + bundled spec ------------------------------------------

def test_target_is_locked_to_petstore():
    body = client.get("/api/target").json()
    assert body["host"] == PETSTORE_HOST
    assert body["locked"] is True
    assert body["specUrl"].startswith("https://petstore.swagger.io/")
    assert body["baseUrl"] == "https://petstore.swagger.io/v2"


def test_bundled_spec_is_petstore():
    spec = client.get("/api/spec").json()
    assert spec["swagger"] == "2.0"
    assert spec["host"] == PETSTORE_HOST
    assert "/pet/{petId}" in spec["paths"]


# --- probe generation ------------------------------------------------------

def test_generate_produces_probes_for_every_target_type():
    result = generate_tests(PETSTORE_SPEC)
    assert result["target"] == "https://petstore.swagger.io/v2"
    assert result["count"] == len(result["tests"]) > 0
    categories = {t["category"] for t in result["tests"]}
    assert {"SQL Injection", "Cross-Site Scripting", "Path Traversal",
            "Malformed Body", "Auth Bypass"} <= categories


def test_generated_probes_are_well_formed():
    tests = generate_tests(PETSTORE_SPEC)["tests"]
    ids = [t["id"] for t in tests]
    assert len(ids) == len(set(ids))  # unique ids
    for t in tests:
        assert t["url"].startswith("https://petstore.swagger.io/v2")
        assert t["method"] in {"GET", "POST", "PUT", "DELETE", "PATCH"}
        assert t["expectedStatuses"]  # non-empty
        assert isinstance(t["headers"], dict)


def test_numeric_path_payload_is_url_encoded():
    tests = generate_tests(PETSTORE_SPEC)["tests"]
    sqli = next(t for t in tests
                if t["operationId"] == "getPetById" and t["category"] == "SQL Injection")
    # raw payload has spaces; the URL must be percent-encoded, not raw.
    assert " " not in sqli["url"]
    assert "1%20OR%201%3D1" in sqli["url"]


def test_auth_probe_targets_secured_operations_only():
    tests = generate_tests(PETSTORE_SPEC)["tests"]
    auth = [t for t in tests if t["category"] == "Auth Bypass"]
    assert auth
    for t in auth:
        assert t["headers"].get("api_key")
        assert t["expectedStatuses"] == [401, 403]
    # placeOrder is not secured -> no auth probe for it
    assert not any(t["operationId"] == "placeOrder" for t in auth)


def test_generation_is_locked_to_petstore_host():
    with pytest.raises(ValueError):
        generate_tests({"host": "evil.example.com", "basePath": "/v2", "paths": {}})


def test_generate_endpoint_rejects_foreign_host():
    resp = client.post("/api/generate", json={"spec": {"host": "evil.example.com", "paths": {}}})
    assert resp.status_code == 400
    assert "locked" in resp.json()["detail"].lower()


def test_generate_endpoint_accepts_bundled_spec():
    resp = client.post("/api/generate", json={"spec": PETSTORE_SPEC})
    assert resp.status_code == 200
    assert resp.json()["count"] > 0
