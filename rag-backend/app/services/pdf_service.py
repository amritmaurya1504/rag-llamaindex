# app/services/pdf_service.py

from pathlib import Path
from pypdf import PdfReader

from app.services.chunk_service import PageText


def extract_pages(file_path: str) -> list[PageText]:
    reader = PdfReader(Path(file_path))
    pages = []
    for page_number, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        pages.append(
            PageText(
                page_number=page_number,
                text=text,
            )
        )

    return pages