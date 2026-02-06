from __future__ import annotations

from pathlib import Path
from typing import Tuple

from docx import Document
from pdfminer.high_level import extract_text


ALLOWED_EXT = {".txt", ".docx", ".pdf"}


def extract_text_from_file(path: Path) -> Tuple[str, str]:
    """
    Returns (text, detected_type)
    """
    ext = path.suffix.lower()
    if ext not in ALLOWED_EXT:
        raise ValueError(f"Unsupported file type: {ext}")

    if ext == ".txt":
        return path.read_text(encoding="utf-8", errors="ignore"), "txt"
    if ext == ".docx":
        doc = Document(str(path))
        parts = []
        for p in doc.paragraphs:
            if p.text and p.text.strip():
                parts.append(p.text.strip())
        return "\n".join(parts), "docx"
    if ext == ".pdf":
        return (extract_text(str(path)) or ""), "pdf"
    raise ValueError(f"Unsupported file type: {ext}")
