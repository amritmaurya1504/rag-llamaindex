from pathlib import Path

from fastapi import (
    APIRouter,
    UploadFile,
    File,
)

from app.services.rag_service import ingest_document


router = APIRouter(
    prefix="/ingest",
    tags=["Ingestion"]
)


UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)


@router.post("")
async def ingest(
    files: list[UploadFile] = File(...)
):
    results = []
    for file in files:
        file_path = (UPLOAD_DIR / file.filename)
        content = await file.read()
        with open(file_path, "wb") as f:
            f.write(content)
        result = ingest_document(
            file_path=str(file_path),
            filename=file.filename
        )
        results.append(result)
    return {"documents": results}