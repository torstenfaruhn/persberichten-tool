from __future__ import annotations

import asyncio
import os
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Tuple

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .extractors import extract_text_from_file, ALLOWED_EXT
from .processing import (
    ValidationResult,
    build_signals,
    enforce_length_warnings,
    naive_rewrite,
    normalize_whitespace,
    validate_input,
)
from .style_guidelines import load_style_guidelines
from .llm import rewrite_with_llm


app = FastAPI(title="Via Persberichten Tool", version="0.1.0")

static_dir = Path(__file__).resolve().parent.parent / "static"
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    return (static_dir / "index.html").read_text(encoding="utf-8")


def _json_error(code: str, message: str, meta: Dict[str, Any] | None = None):
    return JSONResponse(
        status_code=400,
        content={"ok": False, "error": {"code": code, "message": message, "meta": meta or {}}},
    )


async def _process_with_timeout(coro, timeout_s: int = 360):
    return await asyncio.wait_for(coro, timeout=timeout_s)


@app.post("/api/process")
async def process(
    api_key: str = Form(...),
    file: UploadFile = File(...),
) -> JSONResponse:
    if not api_key.strip():
        return _json_error("E001", "API-key is vereist om verder te gaan.")

    suffix = Path(file.filename).suffix.lower()
    if suffix not in ALLOWED_EXT:
        return _json_error("E002", f"Bestandstype niet toegestaan. Toegestaan: {', '.join(sorted(ALLOWED_EXT))}")

    async def _run():
        # Save upload to tmp
        with tempfile.TemporaryDirectory() as td:
            upath = Path(td) / f"upload{suffix}"
            upath.write_bytes(await file.read())

            try:
                raw_text, ftype = extract_text_from_file(upath)
            except Exception:
                return _json_error("E008", "Kon geen tekst uit het bestand halen. Controleer of het geen scan-PDF is.")

            norm = normalize_whitespace(raw_text)

            vres: ValidationResult = validate_input(norm)
            if not vres.ok:
                return _json_error(vres.error_code or "E999", vres.error_message or "Onbekende fout.", vres.meta or {})

            warnings: List[Tuple[str, str]] = list(vres.warnings or [])
            meta: Dict[str, str] = dict(vres.meta or {})
            meta["file_type"] = ftype

            # Try LLM rewrite (optional)
            style_blob = load_style_guidelines()
            used_llm = False
            kop = intro = body = ""
            llm_raw = None
            try:
                llm_res = rewrite_with_llm(api_key=api_key.strip(), style_blob=style_blob, source_text=norm)
                kop, intro, body = llm_res.kop, llm_res.intro, llm_res.body
                used_llm = llm_res.used_llm
                llm_raw = llm_res.raw
            except Exception:
                # fallback deterministic rewrite
                kop, intro, body = naive_rewrite(norm)

            enforce_length_warnings(kop, intro, body, source_len=len(norm), warnings=warnings)

            signals = build_signals(warnings, meta)

            out_txt = (
                f"{kop}\n\n"
                f"{intro}\n\n"
                f"{body}\n\n"
                f"SIGNALEN\n"
                f"{signals}\n\n"
                f"BRON\n"
                f"{file.filename}\n"
            )

            return JSONResponse(
                content={
                    "ok": True,
                    "used_llm": used_llm,
                    "output_txt": out_txt,
                    "signals": signals,
                    "warnings": [{"code": c, "message": m} for c, m in warnings],
                    "meta": meta,
                }
            )

    try:
        return await _process_with_timeout(_run(), timeout_s=360)
    except asyncio.TimeoutError:
        return _json_error("E005", "Time-out: verwerking duurde langer dan 360 seconden.")


@app.get("/health")
def health() -> Dict[str, Any]:
    return {"ok": True, "version": app.version}
