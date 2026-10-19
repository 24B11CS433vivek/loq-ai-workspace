"""
Universal Generator — single entry point for LOQ AI's document
generation feature.

Pipeline (see backend/docgen/ for the actual implementation):
    Prompt / Paste / Files
        -> extraction.py: split into prose + verbatim code blocks
        -> planner.py: Ollama plans a format-appropriate spec
             (ContentSpec for docx/pdf/md/txt/html,
              SlideDeck for pptx, Workbook for xlsx/csv)
        -> renderers.py: deterministic, format-native rendering
             (python-docx / ReportLab / python-pptx / openpyxl / plain text)

Ollama only ever plans structure and prose — it never touches file
formatting, and it never sees (or rewrites) uploaded source code.
"""
import asyncio
import logging
import re
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from docgen.extraction import gather_sources, load_upload
from docgen.planner import (
    append_code_sheet, condense_if_large, plan_document, plan_slides, plan_workbook,
)
from docgen.renderers import render_csv, render_document, render_pptx, render_xlsx

router = APIRouter(prefix="/tools/universal-generate", tags=["universal-generate"])

GENERATED_DIR = Path(__file__).resolve().parent.parent / "generated"
GENERATED_DIR.mkdir(exist_ok=True)

logger = logging.getLogger("routers.universal_generate")

# A 6GB card cannot run two generations at once without OOMing, so only
# one generation is allowed to run at a time; a second request while one
# is in flight is rejected immediately (fails fast) rather than queued.
GEN_SEMAPHORE = asyncio.Semaphore(1)
GEN_TIMEOUT_SECONDS = 240  # hard ceiling on the whole plan+render step


def _cleanup_partial(filename: str | None) -> None:
    """Best-effort removal of a partially-written output file. Never
    raises -- cleanup failing should not mask the original error."""
    if not filename:
        return
    try:
        path = GENERATED_DIR / filename
        if path.exists():
            path.unlink()
    except Exception as e:
        logger.warning("Failed to clean up partial file %s: %s", filename, e)

NARRATIVE_FORMATS = {"docx", "pdf", "md", "txt", "html"}
SLIDE_FORMATS = {"pptx"}
TABULAR_FORMATS = {"xlsx", "csv"}
SUPPORTED_OUTPUT_FORMATS = NARRATIVE_FORMATS | SLIDE_FORMATS | TABULAR_FORMATS


def _slug(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return slug[:40] or "document"


@router.post("")
async def universal_generate(
    prompt: str = Form(""),
    pasted_text: str = Form(""),
    output_format: str = Form(...),
    # Model picked in Settings on the frontend. Optional -- an empty
    # string falls back to planner.py's own PLANNER_MODEL/FALLBACK pair,
    # same behavior as before this existed.
    model: str = Form(""),
    files: list[UploadFile] = File(default=[]),
):
    fmt = output_format.strip().lower().lstrip(".")
    if fmt not in SUPPORTED_OUTPUT_FORMATS:
        raise HTTPException(status_code=400, detail=f"Unsupported output format: {output_format}")
    if not prompt.strip() and not pasted_text.strip() and not files:
        raise HTTPException(status_code=400, detail="Provide a prompt, pasted text, or at least one file")

    uploads = []
    for f in files:
        data = await f.read()
        uploads.append(load_upload(f.filename or "upload", data))
    prose, code_blocks = gather_sources(pasted_text, uploads)
    prose = await condense_if_large(prose, model=model or None)

    fallback_name = prompt.strip() or (uploads[0]["filename"] if uploads else "document")

    filename: str | None = None
    title = count = None

    async def _plan_and_render():
        nonlocal filename, title, count
        if fmt in NARRATIVE_FORMATS:
            spec = await plan_document(prose, prompt, code_blocks, model=model or None)
            title, count = spec.title, len(spec.sections)
            filename = f"{_slug(title or fallback_name)}-{uuid.uuid4().hex[:8]}.{fmt}"
            render_document(spec, fmt, GENERATED_DIR / filename)

        elif fmt in SLIDE_FORMATS:
            deck = await plan_slides(prose, prompt, code_blocks, model=model or None)
            title, count = deck.title, len(deck.slides)
            filename = f"{_slug(title or fallback_name)}-{uuid.uuid4().hex[:8]}.{fmt}"
            render_pptx(deck, GENERATED_DIR / filename)

        else:
            wb = await plan_workbook(prose, prompt, model=model or None)
            append_code_sheet(wb, code_blocks)
            title, count = wb.title, len(wb.sheets)
            filename = f"{_slug(title or fallback_name)}-{uuid.uuid4().hex[:8]}.{fmt}"
            renderer = render_xlsx if fmt == "xlsx" else render_csv
            renderer(wb, GENERATED_DIR / filename)

    # Fail fast instead of queueing: a queued second request would just
    # sit there until it also tries to touch the GPU and OOMs.
    try:
        await asyncio.wait_for(GEN_SEMAPHORE.acquire(), timeout=0.01)
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=429,
            detail="A document is already being generated. A 6GB GPU can only run one generation "
                   "at a time -- please retry in a moment.",
        )

    try:
        try:
            await asyncio.wait_for(_plan_and_render(), timeout=GEN_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            _cleanup_partial(filename)
            raise HTTPException(
                status_code=504,
                detail=f"Generation timed out after {GEN_TIMEOUT_SECONDS}s",
            )
        except HTTPException:
            _cleanup_partial(filename)
            raise
        except Exception as e:
            _cleanup_partial(filename)
            raise HTTPException(status_code=500, detail=f"Failed to generate {fmt}: {e}")
    finally:
        GEN_SEMAPHORE.release()

    out_path = GENERATED_DIR / filename if filename else None
    if not out_path or not out_path.exists() or out_path.stat().st_size == 0:
        _cleanup_partial(filename)
        raise HTTPException(status_code=500, detail=f"Generation produced an empty or missing {fmt} file")

    return {
        "kind": fmt,
        "filename": filename,
        "url": f"/files/{filename}",
        "title": title,
        "section_count": count,
    }
