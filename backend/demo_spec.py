"""The demo OpenAPI spec that the app loads by default.

This is the *only* API-specific data in the backend: it is simply the spec that
gets loaded for the demo. Everything else (route handling and request generation)
is generic and works for any uploaded OpenAPI/Swagger document.

The live spec is fetched by the browser from the demo spec URL; this bundled copy
is a faithful Swagger 2.0 subset used as a resilience fallback so the tool still
works when the browser cannot reach the live service.
"""

DEMO_SPEC_URL = "https://petstore.swagger.io/v2/swagger.json"

DEMO_SPEC = {
    "swagger": "2.0",
    "info": {
        "title": "Swagger Petstore",
        "version": "1.0.7",
        "description": "This is a sample server Petstore server, used as a locked demo target.",
    },
    "host": "petstore.swagger.io",
    "basePath": "/v2",
    "schemes": ["https"],
    "securityDefinitions": {
        "api_key": {"type": "apiKey", "name": "api_key", "in": "header"},
        "petstore_auth": {"type": "oauth2", "flow": "implicit"},
    },
    "paths": {
        "/pet": {
            "post": {
                "operationId": "addPet",
                "summary": "Add a new pet to the store",
                "security": [{"petstore_auth": ["write:pets", "read:pets"]}],
                "parameters": [
                    {"in": "body", "name": "body", "required": True, "schema": {"$ref": "#/definitions/Pet"}}
                ],
            },
            "put": {
                "operationId": "updatePet",
                "summary": "Update an existing pet",
                "security": [{"petstore_auth": ["write:pets", "read:pets"]}],
                "parameters": [
                    {"in": "body", "name": "body", "required": True, "schema": {"$ref": "#/definitions/Pet"}}
                ],
            },
        },
        "/pet/findByStatus": {
            "get": {
                "operationId": "findPetsByStatus",
                "summary": "Finds Pets by status",
                "security": [{"petstore_auth": ["write:pets", "read:pets"]}],
                "parameters": [
                    {"name": "status", "in": "query", "required": True, "type": "array"}
                ],
            }
        },
        "/pet/findByTags": {
            "get": {
                "operationId": "findPetsByTags",
                "summary": "Finds Pets by tags",
                "security": [{"petstore_auth": ["write:pets", "read:pets"]}],
                "parameters": [
                    {"name": "tags", "in": "query", "required": True, "type": "array"}
                ],
            }
        },
        "/pet/{petId}": {
            "get": {
                "operationId": "getPetById",
                "summary": "Find pet by ID",
                "security": [{"api_key": []}],
                "parameters": [
                    {"name": "petId", "in": "path", "required": True, "type": "integer", "format": "int64"}
                ],
            },
            "post": {
                "operationId": "updatePetWithForm",
                "summary": "Updates a pet in the store with form data",
                "security": [{"petstore_auth": ["write:pets", "read:pets"]}],
                "parameters": [
                    {"name": "petId", "in": "path", "required": True, "type": "integer", "format": "int64"},
                    {"name": "name", "in": "formData", "required": False, "type": "string"},
                    {"name": "status", "in": "formData", "required": False, "type": "string"},
                ],
            },
            "delete": {
                "operationId": "deletePet",
                "summary": "Deletes a pet",
                "security": [{"petstore_auth": ["write:pets", "read:pets"]}],
                "parameters": [
                    {"name": "api_key", "in": "header", "required": False, "type": "string"},
                    {"name": "petId", "in": "path", "required": True, "type": "integer", "format": "int64"},
                ],
            },
        },
        "/pet/{petId}/uploadImage": {
            "post": {
                "operationId": "uploadFile",
                "summary": "uploads an image",
                "security": [{"petstore_auth": ["write:pets", "read:pets"]}],
                "parameters": [
                    {"name": "petId", "in": "path", "required": True, "type": "integer", "format": "int64"},
                    {"name": "additionalMetadata", "in": "formData", "required": False, "type": "string"},
                ],
            }
        },
        "/store/inventory": {
            "get": {
                "operationId": "getInventory",
                "summary": "Returns pet inventories by status",
                "security": [{"api_key": []}],
                "parameters": [],
            }
        },
        "/store/order": {
            "post": {
                "operationId": "placeOrder",
                "summary": "Place an order for a pet",
                "parameters": [
                    {"in": "body", "name": "body", "required": True, "schema": {"$ref": "#/definitions/Order"}}
                ],
            }
        },
        "/store/order/{orderId}": {
            "get": {
                "operationId": "getOrderById",
                "summary": "Find purchase order by ID",
                "parameters": [
                    {"name": "orderId", "in": "path", "required": True, "type": "integer", "format": "int64"}
                ],
            },
            "delete": {
                "operationId": "deleteOrder",
                "summary": "Delete purchase order by ID",
                "parameters": [
                    {"name": "orderId", "in": "path", "required": True, "type": "integer", "format": "int64"}
                ],
            },
        },
        "/user": {
            "post": {
                "operationId": "createUser",
                "summary": "Create user",
                "parameters": [
                    {"in": "body", "name": "body", "required": True, "schema": {"$ref": "#/definitions/User"}}
                ],
            }
        },
        "/user/createWithArray": {
            "post": {
                "operationId": "createUsersWithArrayInput",
                "summary": "Creates list of users with given input array",
                "parameters": [
                    {"in": "body", "name": "body", "required": True, "schema": {"type": "array"}}
                ],
            }
        },
        "/user/login": {
            "get": {
                "operationId": "loginUser",
                "summary": "Logs user into the system",
                "parameters": [
                    {"name": "username", "in": "query", "required": True, "type": "string"},
                    {"name": "password", "in": "query", "required": True, "type": "string"},
                ],
            }
        },
        "/user/logout": {
            "get": {
                "operationId": "logoutUser",
                "summary": "Logs out current logged in user session",
                "parameters": [],
            }
        },
        "/user/{username}": {
            "get": {
                "operationId": "getUserByName",
                "summary": "Get user by user name",
                "parameters": [
                    {"name": "username", "in": "path", "required": True, "type": "string"}
                ],
            },
            "put": {
                "operationId": "updateUser",
                "summary": "Updated user",
                "parameters": [
                    {"name": "username", "in": "path", "required": True, "type": "string"},
                    {"in": "body", "name": "body", "required": True, "schema": {"$ref": "#/definitions/User"}},
                ],
            },
            "delete": {
                "operationId": "deleteUser",
                "summary": "Delete user",
                "parameters": [
                    {"name": "username", "in": "path", "required": True, "type": "string"}
                ],
            },
        },
    },
}
