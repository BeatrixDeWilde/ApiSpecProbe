import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import gemini
from app import app
from demo_spec import DEMO_SPEC, DEMO_SPEC_URL
from openapi import base_url, build_url


def client_with_env(**secrets):
    env = SimpleNamespace(**secrets)

    async def with_env(scope, receive, send):
        scope["env"] = env
        await app(scope, receive, send)

    return TestClient(with_env)


client = TestClient(app)


# --- spec loading (the only API-specific piece) ----------------------------

def test_target_reports_demo_spec_and_derived_base():
    body = client.get("/api/target").json()
    assert body["specUrl"] == DEMO_SPEC_URL
    assert body["baseUrl"] == "https://petstore.swagger.io/v2"


def test_bundled_spec_is_served():
    spec = client.get("/api/spec").json()
    assert spec["swagger"] == "2.0"
    assert "/pet/{petId}" in spec["paths"]


def test_cached_probes_have_sample_responses():
    result = client.get("/api/cached").json()
    assert result["cached"] is True
    assert result["count"] == len(result["tests"]) > 0
    for t in result["tests"]:
        assert t["url"].startswith("https://petstore.swagger.io/v2")
        cr = t["cachedResponse"]
        assert isinstance(cr["status"], int)
        assert "body" in cr


# --- generic OpenAPI helpers -----------------------------------------------

def test_base_url_supports_swagger2_and_openapi3():
    assert base_url(DEMO_SPEC) == "https://petstore.swagger.io/v2"
    assert base_url({"servers": [{"url": "https://api.example.com/v1/"}]}) == "https://api.example.com/v1"
    assert base_url({}) == ""


def test_build_url_encodes_path_and_query():
    url = build_url("https://api.example.com/v1", "/pet/{petId}",
                    [("petId", "1 OR 1=1")], [("q", "<script>")])
    assert url == "https://api.example.com/v1/pet/1%20OR%201%3D1?q=%3Cscript%3E"


# --- Gemini generation (transport injected; no network) --------------------

def _gemini_response(items):
    return {"candidates": [{"content": {"parts": [{"text": json.dumps(items)}]}}]}


SAMPLE_ITEMS = [
    {
        "name": "SQLi in petId", "category": "SQL Injection", "rationale": "boolean clause",
        "target": "path petId", "payload": "1 OR 1=1", "method": "get", "path": "/pet/{petId}",
        "pathParams": [{"name": "petId", "value": "1 OR 1=1"}], "query": [], "headers": [],
        "body": "", "expectedStatuses": [400, 404], "expectedBehavior": "reject",
    },
    {
        "name": "XSS in status", "category": "Cross-Site Scripting", "rationale": "reflected",
        "target": "query status", "payload": "<script>", "method": "get",
        "path": "/pet/findByStatus", "pathParams": [],
        "query": [{"name": "status", "value": "<script>alert(1)</script>"}],
        "headers": [{"name": "api_key", "value": "junk"}], "body": "",
        "expectedStatuses": [400], "expectedBehavior": "reject",
    },
]


def test_generate_requests_normalises_model_output():
    async def fake_post(url, headers, payload):
        assert headers["x-goog-api-key"] == "secret-key"
        assert "generateContent" in url
        return _gemini_response(SAMPLE_ITEMS)

    result = asyncio.run(gemini.generate_requests(DEMO_SPEC, "secret-key", post=fake_post))
    assert result["target"] == "https://petstore.swagger.io/v2"
    assert result["count"] == 2
    ids = [t["id"] for t in result["tests"]]
    assert ids == ["probe-0", "probe-1"]

    sqli = result["tests"][0]
    assert sqli["method"] == "GET"
    assert sqli["url"] == "https://petstore.swagger.io/v2/pet/1%20OR%201%3D1"
    assert sqli["expectedStatuses"] == [400, 404]

    xss = result["tests"][1]
    assert xss["headers"] == {"api_key": "junk"}
    assert "status=%3Cscript%3E" in xss["url"]
    # Every probe carries a cached sample response for the step-3 fallback.
    assert sqli["cachedResponse"]["status"] == 400  # first expectedStatus (no sampleResponse)


def test_sample_response_becomes_cached_response():
    items = [{
        "name": "n", "category": "c", "method": "get", "path": "/pet/{petId}",
        "pathParams": [{"name": "petId", "value": "9"}], "expectedStatuses": [400, 404],
        "sampleResponse": {"status": 200, "body": '{"id":9,"name":"accepted"}'},
    }]

    async def fake_post(url, headers, payload):
        return _gemini_response(items)

    result = asyncio.run(gemini.generate_requests(DEMO_SPEC, "k", post=fake_post))
    cr = result["tests"][0]["cachedResponse"]
    assert cr["status"] == 200
    assert cr["source"] == "gemini"
    assert "accepted" in cr["body"]


def test_generate_requests_defaults_missing_statuses():
    items = [{"name": "n", "category": "c", "method": "post", "path": "/user",
              "expectedStatuses": []}]

    async def fake_post(url, headers, payload):
        return _gemini_response(items)

    result = asyncio.run(gemini.generate_requests(DEMO_SPEC, "k", post=fake_post))
    assert result["tests"][0]["expectedStatuses"] == gemini.DEFAULT_EXPECTED_STATUSES


def test_generate_requests_rejects_non_spec():
    async def fake_post(url, headers, payload):  # should never be called
        raise AssertionError("model should not be called for an invalid spec")

    with pytest.raises(ValueError):
        asyncio.run(gemini.generate_requests({"not": "a spec"}, "k", post=fake_post))


def test_generate_requests_raises_on_bad_gemini_output():
    async def fake_post(url, headers, payload):
        return {"promptFeedback": {"blockReason": "SAFETY"}}

    with pytest.raises(gemini.GeminiError):
        asyncio.run(gemini.generate_requests(DEMO_SPEC, "k", post=fake_post, backoff=0))


def test_generate_retries_transient_error_then_succeeds():
    calls = {"n": 0}

    async def flaky_post(url, headers, payload):
        calls["n"] += 1
        if calls["n"] == 1:
            raise gemini.GeminiError("Gemini API error 500: Internal Server Error", retryable=True)
        return _gemini_response(SAMPLE_ITEMS)

    result = asyncio.run(gemini.generate_requests(DEMO_SPEC, "k", post=flaky_post, backoff=0))
    assert calls["n"] == 2
    assert result["count"] == 2


def test_generate_gives_up_after_retries():
    calls = {"n": 0}

    async def always_500(url, headers, payload):
        calls["n"] += 1
        raise gemini.GeminiError("Gemini API error 500: Internal Server Error", retryable=True)

    with pytest.raises(gemini.GeminiError):
        asyncio.run(gemini.generate_requests(DEMO_SPEC, "k", post=always_500, retries=1, backoff=0))
    assert calls["n"] == 2  # original attempt + one retry


def test_generate_does_not_retry_non_retryable_error():
    calls = {"n": 0}

    async def not_found(url, headers, payload):
        calls["n"] += 1
        raise gemini.GeminiError("Gemini API error 404: model gone", retryable=False)

    with pytest.raises(gemini.GeminiError):
        asyncio.run(gemini.generate_requests(DEMO_SPEC, "k", post=not_found, retries=1, backoff=0))
    assert calls["n"] == 1  # not retried


def test_generate_route_returns_json_on_unexpected_error(monkeypatch):
    async def boom(url, headers, payload):
        raise RuntimeError("kaboom")  # unexpected, non-GeminiError

    monkeypatch.setattr(gemini, "_default_post", boom)
    resp = client_with_env(GEMINI_API_KEY="k").post("/api/generate", json={"spec": DEMO_SPEC})
    assert resp.status_code == 502
    # Body must be valid JSON with a detail, never a raw "Internal Server Error".
    assert "kaboom" in resp.json()["detail"]


def test_generate_is_not_locked_to_any_host(monkeypatch):
    async def fake_post(url, headers, payload):
        return _gemini_response(SAMPLE_ITEMS)

    monkeypatch.setattr(gemini, "_default_post", fake_post)
    other_spec = {"host": "api.other.com", "basePath": "/v1", "schemes": ["https"],
                  "paths": {"/pet/{petId}": {"get": {"operationId": "x"}}}}
    resp = client_with_env(GEMINI_API_KEY="k").post("/api/generate", json={"spec": other_spec})
    assert resp.status_code == 200
    assert resp.json()["target"] == "https://api.other.com/v1"


# --- /api/generate route ---------------------------------------------------

def test_generate_requires_api_key():
    resp = client_with_env().post("/api/generate", json={"spec": DEMO_SPEC})
    assert resp.status_code == 503
    assert "GEMINI_API_KEY" in resp.json()["detail"]


def test_generate_route_returns_probes(monkeypatch):
    async def fake_post(url, headers, payload):
        return _gemini_response(SAMPLE_ITEMS)

    monkeypatch.setattr(gemini, "_default_post", fake_post)
    resp = client_with_env(GEMINI_API_KEY="k").post("/api/generate", json={"spec": DEMO_SPEC})
    assert resp.status_code == 200
    assert resp.json()["count"] == 2
