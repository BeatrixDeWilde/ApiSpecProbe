"""A cached set of probe requests for the demo.

Used as a fallback for step 2 when live Gemini generation is unavailable (no API
key configured, quota exhausted, or a transient failure). Each probe carries the
same shape the live generator produces, plus a ``cachedResponse`` that reflects
how the real Swagger Petstore tends to answer the probe — so the third step
(send + evaluate) can also be demonstrated without a live network call.

The responses below are representative of the public Petstore, which is
deliberately lax: it accepts much of the malicious input rather than rejecting
it, which is exactly what the tool is meant to surface.
"""

from openapi import base_url, build_url
from demo_spec import DEMO_SPEC

_BASE = base_url(DEMO_SPEC)


def _probe(index, **kw):
    statuses = kw["expectedStatuses"]
    return {
        "id": f"cached-{index}",
        "operationId": kw["operationId"],
        "summary": kw["summary"],
        "name": kw["name"],
        "category": kw["category"],
        "rationale": kw["rationale"],
        "target": kw["target"],
        "payload": kw["payload"],
        "method": kw["method"],
        "path": kw["path"],
        "url": build_url(_BASE, kw["path"], kw.get("pathParams"), kw.get("query")),
        "headers": kw.get("headers", {}),
        "body": kw.get("body"),
        "expectedStatuses": statuses,
        "expectedBehavior": f"Reject the probe with a client error ({', '.join(map(str, statuses))}).",
        "cachedResponse": {
            "status": kw["responseStatus"],
            "statusText": kw.get("responseStatusText", ""),
            "body": kw["responseBody"],
            "source": "cached",
        },
    }


_SPECS = [
    dict(
        operationId="getPetById", summary="Find pet by ID",
        name="SQL Injection via path `petId`", category="SQL Injection",
        rationale="Boolean SQL clause injected where a numeric ID is expected.",
        target="path `petId`", payload="1 OR 1=1", method="GET", path="/pet/{petId}",
        pathParams=[("petId", "1 OR 1=1")], expectedStatuses=[400, 404, 405],
        responseStatus=404, responseStatusText="Not Found",
        responseBody='{"code":1,"type":"error","message":"Pet not found"}',
    ),
    dict(
        operationId="getPetById", summary="Find pet by ID",
        name="Negative Boundary via path `petId`", category="Negative Boundary",
        rationale="Negative identifier probes boundary and unsigned-integer handling.",
        target="path `petId`", payload="-1", method="GET", path="/pet/{petId}",
        pathParams=[("petId", "-1")], expectedStatuses=[400, 404, 422],
        responseStatus=404, responseStatusText="Not Found",
        responseBody='{"code":1,"type":"error","message":"Pet not found"}',
    ),
    dict(
        operationId="addPet", summary="Add a new pet to the store",
        name="Malformed Body via request body", category="Malformed Body",
        rationale="Every field carries a wrong-typed value to test schema validation.",
        target="request body", payload="type-confused JSON object", method="POST", path="/pet",
        headers={"Content-Type": "application/json"},
        body={"id": "not-an-integer", "name": ["array", "not", "string"], "status": True},
        expectedStatuses=[400, 415, 422],
        responseStatus=500, responseStatusText="Internal Server Error",
        responseBody='{"code":500,"type":"unknown","message":"something bad happened"}',
    ),
    dict(
        operationId="addPet", summary="Add a new pet to the store",
        name="Oversized Payload via request body", category="Oversized Payload",
        rationale="A large field probes length limits and buffer handling.",
        target="request body", payload="4 KB string field", method="POST", path="/pet",
        headers={"Content-Type": "application/json"},
        body={"name": "A" * 4096},
        expectedStatuses=[400, 413, 422],
        responseStatus=200, responseStatusText="OK",
        responseBody='{"id":9223372036854775807,"name":"AAAA…","photoUrls":[],"tags":[]}',
    ),
    dict(
        operationId="findPetsByStatus", summary="Finds Pets by status",
        name="Cross-Site Scripting via query `status`", category="Cross-Site Scripting",
        rationale="Reflected-XSS payload to check output encoding.",
        target="query `status`", payload="<script>alert(1)</script>", method="GET",
        path="/pet/findByStatus", query=[("status", "<script>alert(1)</script>")],
        expectedStatuses=[400, 422],
        responseStatus=200, responseStatusText="OK", responseBody="[]",
    ),
    dict(
        operationId="getInventory", summary="Returns pet inventories by status",
        name="Auth Bypass via api_key header", category="Auth Bypass",
        rationale="Injection payload sent as the api_key header on a secured operation.",
        target="api_key header", payload="' OR '1'='1", method="GET", path="/store/inventory",
        headers={"api_key": "' OR '1'='1"}, expectedStatuses=[401, 403],
        responseStatus=200, responseStatusText="OK",
        responseBody='{"sold":12,"string":620,"pending":5,"available":289}',
    ),
    dict(
        operationId="loginUser", summary="Logs user into the system",
        name="SQL Injection via query `username`", category="SQL Injection",
        rationale="SQL injection string in a query-string value.",
        target="query `username`", payload="' OR '1'='1", method="GET", path="/user/login",
        query=[("username", "' OR '1'='1"), ("password", "x")],
        expectedStatuses=[400, 422],
        responseStatus=200, responseStatusText="OK",
        responseBody='{"code":200,"type":"unknown","message":"logged in user session:1699999999999"}',
    ),
]

CACHED_RESULT = {
    "target": _BASE,
    "count": len(_SPECS),
    "cached": True,
    "tests": [_probe(i, **spec) for i, spec in enumerate(_SPECS)],
}
