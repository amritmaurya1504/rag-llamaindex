from fastapi import FastAPI
from app.db.postgres import create_tables
from app.api.ingest import router as ingest_router
from app.api.chat import router as chat_router
from fastapi.openapi.utils import get_openapi
from fastapi.middleware.cors import CORSMiddleware


app = FastAPI(
    title="RAG Backend",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],

)

def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    schema = get_openapi(
        title=app.title,
        version=app.version,
        routes=app.routes,
    )

    # Use OpenAPI 3.0 for better Swagger file-upload support
    schema["openapi"] = "3.0.3"
    components = schema.get("components", {}).get("schemas", {})
    for schema_def in components.values():
        properties = schema_def.get("properties", {})
        for prop in properties.values():
            # Multiple file uploads
            if prop.get("type") == "array":
                items = prop.get("items", {})
                if items.get("contentMediaType") == "application/octet-stream":
                    items.pop("contentMediaType", None)
                    items["format"] = "binary"
            # Single file upload
            if (
                prop.get("type") == "string"
                and prop.get("contentMediaType") == "application/octet-stream"
            ):
                prop.pop("contentMediaType", None)
                prop["format"] = "binary"
    app.openapi_schema = schema
    return app.openapi_schema


app.openapi = custom_openapi

@app.on_event("startup")
def startup():
    create_tables()


app.include_router(ingest_router,prefix="/api")
app.include_router(chat_router,prefix="/api")

@app.get("/health")
def health():
    return {
        "status": "ok"
    }