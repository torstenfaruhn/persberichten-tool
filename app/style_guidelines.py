from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import List

from docx import Document
from pdfminer.high_level import extract_text


STYLEBOOK_PATHS = [
    Path("stylebooks_via-persberichten-tool.docx"),
    Path("stylebooks_Stijlboek en typografie De Limburger.docx"),
    Path("stylebooks_DL-Stijlboek-Afspraken.pdf"),
    Path("stylebooks_DL-Stijlboek-Veelgemaakte-fouten.pdf"),
]


def _read_docx(path: Path) -> str:
    doc = Document(str(path))
    parts: List[str] = []
    for p in doc.paragraphs:
        t = (p.text or "").strip()
        if t:
            parts.append(t)
    return "\n".join(parts)


def _read_pdf(path: Path) -> str:
    # pdfminer returns text in reading order; tables can be messy, but good enough for a guidance prompt.
    return (extract_text(str(path)) or "").strip()


def load_style_guidelines(extra_paths: List[Path] | None = None, max_chars: int = 20000) -> str:
    """
    Loads style guidance from included stylebooks.
    Returns a single concatenated text blob, truncated to max_chars to keep prompts bounded.
    """
    paths = list(STYLEBOOK_PATHS)
    if extra_paths:
        paths.extend(extra_paths)

    chunks: List[str] = []
    for p in paths:
        try:
            if not p.exists():
                continue
            if p.suffix.lower() == ".docx":
                txt = _read_docx(p)
            elif p.suffix.lower() == ".pdf":
                txt = _read_pdf(p)
            else:
                continue
            if txt:
                chunks.append(f"[{p.name}]\n{txt}")
        except Exception:
            # If a stylebook fails to parse we still continue; the app must remain usable.
            continue

    blob = "\n\n".join(chunks).strip()
    if len(blob) > max_chars:
        blob = blob[:max_chars] + "\n\n[...truncated...]"
    return blob
