"""Planning: turn extracted prose into a format-appropriate content spec.

Three planner prompts (document / slides / workbook) instead of one
generic "title + paragraphs" prompt — this is what actually fixes "every
output format contains the same paragraphs": a spreadsheet request gets
asked to produce rows/columns, a slide request gets asked for short
glanceable bullets, a document request gets asked for real prose.

For large prose inputs, a lightweight map-reduce condenses the source
first (condense_if_large) so nothing is blindly truncated away and the
final planning call stays fast.
"""
import asyncio
import json
import logging
import re
from typing import Optional

import httpx

from docgen.spec import (
    CodeBlock, ContentSpec, Section, Sheet, Slide, SlideDeck, TableBlock, Workbook,
)

OLLAMA_URL = "http://localhost:11434"
PLANNER_MODEL = "qwen2.5-coder:7b"
PLANNER_MODEL_FALLBACK = "qwen3:4b"

DIRECT_CHAR_LIMIT = 9000   # prose under this goes straight to the planner
CHUNK_CHARS = 3000
MAX_CHUNKS = 8
MAX_SECTIONS = 12
MAX_SLIDES = 16
MAX_SHEETS = 6


# --------------------------------------------------------------------------
# Ollama plumbing
# --------------------------------------------------------------------------

OLLAMA_NUM_CTX = 4096       # caps context so one request can't exceed 6GB VRAM
OLLAMA_NUM_PREDICT = 1024   # caps output length, same reason
OLLAMA_KEEP_ALIVE = "30s"   # evict the model between calls instead of pinning VRAM
OLLAMA_MAX_RETRIES = 2
OLLAMA_RETRY_BACKOFF = 2.0  # seconds, doubles each retry

logger = logging.getLogger("docgen.planner")


async def _call_ollama(prompt: str, *, json_mode: bool, temperature: float = 0.3, model: str | None = None) -> str:
    """Call Ollama for planning text. Tuned for a 6GB VRAM card: capped
    context/output length so a single request can't blow past available
    VRAM, a short keep_alive so the model is evicted between calls
    instead of pinning VRAM, and retries with backoff on transient
    failures. This function NEVER raises -- on total failure it returns
    "" so a flaky/overloaded/OOM'd Ollama can never crash the pipeline;
    callers already treat an empty planner response as "fall back".

    `model`, when given, is whatever the user picked in Settings on the
    frontend -- it's tried first. PLANNER_MODEL_FALLBACK still backs it
    up so a request never hard-fails just because the chosen model is
    unavailable or OOMs; it's only skipped if it's the same model the
    user already picked (no point trying it twice)."""
    payload = {
        "prompt": prompt,
        "stream": False,
        "keep_alive": OLLAMA_KEEP_ALIVE,
        "options": {
            "temperature": temperature,
            "top_p": 0.9,
            "num_ctx": OLLAMA_NUM_CTX,
            "num_predict": OLLAMA_NUM_PREDICT,
        },
    }
    if json_mode:
        payload["format"] = "json"

    primary = (model or "").strip() or PLANNER_MODEL
    models_to_try = [primary] if primary == PLANNER_MODEL_FALLBACK else [primary, PLANNER_MODEL_FALLBACK]

    for model in models_to_try:
        delay = OLLAMA_RETRY_BACKOFF
        for attempt in range(OLLAMA_MAX_RETRIES + 1):
            try:
                async with httpx.AsyncClient(timeout=180) as client:
                    res = await client.post(f"{OLLAMA_URL}/api/generate", json={**payload, "model": model})
                    res.raise_for_status()
                    text = res.json().get("response", "").strip()
                if text:
                    return text
                break  # valid-but-empty response: try the fallback model, don't retry
            except (httpx.TimeoutException, httpx.ConnectError) as e:
                logger.warning(
                    "Ollama call to %s failed (attempt %d/%d): %s",
                    model, attempt + 1, OLLAMA_MAX_RETRIES + 1, e,
                )
                if attempt < OLLAMA_MAX_RETRIES:
                    await asyncio.sleep(delay)
                    delay *= 2
                    continue
                break
            except Exception as e:
                logger.warning("Ollama call to %s failed: %s", model, e)
                break
    return ""


def _extract_json(raw: str) -> Optional[dict]:
    raw = (raw or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-zA-Z]*\n?|```$", "", raw, flags=re.MULTILINE).strip()
    try:
        obj = json.loads(raw)
        return obj if isinstance(obj, dict) else None
    except Exception:
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                return None
    return None


def _chunk_text(text: str, size: int) -> list:
    paras = re.split(r"\n\s*\n", text)
    chunks, cur = [], ""
    for p in paras:
        if cur and len(cur) + len(p) + 2 > size:
            chunks.append(cur)
            cur = p
        else:
            cur = f"{cur}\n\n{p}" if cur else p
    if cur:
        chunks.append(cur)
    return chunks or [text]


async def condense_if_large(prose_text: str, model: str | None = None) -> str:
    """Map-reduce condensation so long inputs are digested instead of
    either being blindly truncated (losing the back half) or blowing
    the planner's effective context window."""
    if len(prose_text) <= DIRECT_CHAR_LIMIT:
        return prose_text

    chunks = _chunk_text(prose_text, CHUNK_CHARS)
    if len(chunks) > MAX_CHUNKS:
        chunks = _chunk_text(prose_text, len(prose_text) // MAX_CHUNKS + 1)

    notes = []
    for i, chunk in enumerate(chunks, start=1):
        prompt = (
            "Extract the key facts, names, numbers and points from this excerpt as "
            "terse bullet points. No commentary, no opinions. Preserve exact figures "
            f"and names verbatim.\n\nEXCERPT {i}/{len(chunks)}:\n{chunk}"
        )
        out = await _call_ollama(prompt, json_mode=False, temperature=0.1, model=model)
        if out.strip():
            notes.append(f"[Part {i}]\n{out.strip()}")
    return "\n\n".join(notes) or prose_text[:DIRECT_CHAR_LIMIT]


def _code_manifest(code_blocks: list) -> str:
    if not code_blocks:
        return ""
    lines = [
        "\n\nATTACHED SOURCE FILES (their code will be embedded verbatim "
        "automatically — do not rewrite, repeat, or summarize their contents "
        "line-by-line; just reference them naturally in the narrative if relevant):"
    ]
    for c in code_blocks:
        n_lines = c["content"].count("\n") + 1
        lines.append(f"- {c['filename']} ({c['language']}, {n_lines} lines)")
    return "\n".join(lines)


# --------------------------------------------------------------------------
# Narrative documents (docx / pdf / md / txt / html)
# --------------------------------------------------------------------------

async def plan_document(prose: str, user_prompt: str, code_blocks: list, model: str | None = None) -> ContentSpec:
    instruction = user_prompt.strip() or "Summarize and structure the source content into a clean, well-organized document."
    basis = f"\n\nSOURCE CONTENT:\n{prose}" if prose.strip() else ""
    prompt = f"""You are a professional document planner. Output ONLY one JSON object — no prose, no markdown fences.

USER REQUEST: "{instruction}"{basis}{_code_manifest(code_blocks)}

Schema:
{{"title": "string", "subtitle": "string", "sections": [
  {{"heading": "string", "level": 1, "paragraphs": ["string"], "bullets": ["string"], "numbered": false,
    "table": {{"headers": ["string"], "rows": [["string"]]}} }}
]}}

Rules:
- 4 to {MAX_SECTIONS} sections. "level": 2 for a sub-point that follows the level-1 section it belongs to.
- Write real, substantive paragraphs (2-5 sentences each), not filler. Use "bullets" for short list items, set "numbered": true when order/rank matters.
- Only include "table" when the content is genuinely tabular (comparisons, specs, consistent columns) and every row has the same number of cells as "headers"; otherwise omit it entirely.
- Ground everything in SOURCE CONTENT when provided — do not contradict it or invent facts not implied by it.
- Never reproduce code — attached source files are inserted separately."""
    data = _extract_json(await _call_ollama(prompt, json_mode=True, temperature=0.3, model=model))
    spec = _normalize_document(data, instruction, prose)
    _append_code_sections(spec, code_blocks)
    return spec


def _normalize_document(data: Optional[dict], instruction: str, prose: str) -> ContentSpec:
    sections_raw = data.get("sections") if isinstance(data, dict) else None
    if not isinstance(sections_raw, list) or not sections_raw:
        return _fallback_document(instruction, prose)

    sections = []
    for s in sections_raw[:MAX_SECTIONS]:
        if not isinstance(s, dict):
            continue
        paragraphs = [str(p) for p in (s.get("paragraphs") or []) if str(p).strip()]
        bullets = [str(b) for b in (s.get("bullets") or []) if str(b).strip()]
        table = None
        t = s.get("table")
        if isinstance(t, dict):
            headers = [str(h) for h in (t.get("headers") or [])]
            rows = [[str(c) for c in r] for r in (t.get("rows") or []) if isinstance(r, list)]
            rows = [r for r in rows if len(r) == len(headers)] if headers else []
            if headers and rows:
                table = TableBlock(headers=headers, rows=rows)
        if not paragraphs and not bullets and not table:
            continue
        sections.append(Section(
            heading=str(s.get("heading") or "")[:150],
            level=2 if s.get("level") == 2 else 1,
            paragraphs=paragraphs, bullets=bullets,
            numbered=bool(s.get("numbered")), table=table,
        ))

    if not sections:
        return _fallback_document(instruction, prose)
    title = str(data.get("title") or instruction or "Generated Document")[:120]
    subtitle = str(data.get("subtitle") or "")[:200]
    return ContentSpec(title=title, subtitle=subtitle, sections=sections)


def _fallback_document(instruction: str, prose: str) -> ContentSpec:
    if prose.strip():
        chunks = [c.strip() for c in re.split(r"\n\s*\n", prose.strip()) if c.strip()]
        return ContentSpec(
            title=(instruction or "Generated Document")[:120],
            sections=[Section(heading="Content", paragraphs=chunks[:MAX_SECTIONS] or [prose[:2000]])],
        )
    return ContentSpec(
        title=(instruction or "Generated Document")[:120],
        sections=[Section(heading="Overview", paragraphs=[
            f'Content for "{instruction}" could not be auto-planned — edit manually.'
        ])],
    )


def _append_code_sections(spec: ContentSpec, code_blocks: list) -> None:
    for c in code_blocks:
        spec.sections.append(Section(
            heading=c["filename"], level=1,
            code=CodeBlock(language=c["language"], content=c["content"], caption=c["filename"]),
        ))


# --------------------------------------------------------------------------
# Slide decks (pptx)
# --------------------------------------------------------------------------

async def plan_slides(prose: str, user_prompt: str, code_blocks: list, model: str | None = None) -> SlideDeck:
    instruction = user_prompt.strip() or "Turn the source content into a clear, well-structured slide deck."
    basis = f"\n\nSOURCE CONTENT:\n{prose}" if prose.strip() else ""
    prompt = f"""You are a presentation designer. Output ONLY one JSON object — no prose, no fences.

USER REQUEST: "{instruction}"{basis}{_code_manifest(code_blocks)}

Schema:
{{"title": "string", "subtitle": "string", "slides": [{{"title": "string", "bullets": ["string"], "notes": "string"}}]}}

Rules:
- 6 to {MAX_SLIDES} content slides (the title/subtitle become their own title slide automatically — don't repeat them as slide 1).
- Each slide: a short punchy title (<=8 words) and 3-5 bullets, each bullet <=12 words. Slides are glanceable, never paragraphs.
- Put elaboration in "notes" (1-3 sentences) instead of cramming it into bullets.
- Group related points onto the same slide rather than one slide per tiny fact."""
    data = _extract_json(await _call_ollama(prompt, json_mode=True, temperature=0.35, model=model))
    deck = _normalize_slides(data, instruction, prose)
    _append_code_slides(deck, code_blocks)
    return deck


def _normalize_slides(data: Optional[dict], instruction: str, prose: str) -> SlideDeck:
    slides_raw = data.get("slides") if isinstance(data, dict) else None
    if not isinstance(slides_raw, list) or not slides_raw:
        return _fallback_slides(instruction, prose)

    slides = []
    for s in slides_raw[:MAX_SLIDES]:
        if not isinstance(s, dict):
            continue
        bullets = [str(b) for b in (s.get("bullets") or []) if str(b).strip()][:6]
        if not bullets:
            continue
        slides.append(Slide(title=str(s.get("title") or "")[:120], bullets=bullets, notes=str(s.get("notes") or "")[:500]))

    if not slides:
        return _fallback_slides(instruction, prose)
    title = str(data.get("title") or instruction or "Generated Presentation")[:120]
    subtitle = str(data.get("subtitle") or "")[:200]
    return SlideDeck(title=title, subtitle=subtitle, slides=slides)


def _fallback_slides(instruction: str, prose: str) -> SlideDeck:
    chunks = [c.strip() for c in re.split(r"\n\s*\n", prose.strip()) if c.strip()][:MAX_SLIDES] if prose.strip() else []
    slides = [Slide(title=f"Point {i+1}", bullets=[c[:200]]) for i, c in enumerate(chunks)] or [
        Slide(title="Overview", bullets=[f'Content for "{instruction}" could not be auto-planned — edit manually.'])
    ]
    return SlideDeck(title=(instruction or "Generated Presentation")[:120], slides=slides)


def _append_code_slides(deck: SlideDeck, code_blocks: list) -> None:
    for c in code_blocks:
        lines = c["content"].splitlines() or [""]
        preview = lines[:14]
        if len(lines) > 14:
            preview.append("…")
        deck.slides.append(Slide(
            title=f"Code — {c['filename']}", bullets=preview or ["(empty file)"],
            notes=f"Full file: {c['filename']} ({len(lines)} lines, {c['language']})", code=True,
        ))


# --------------------------------------------------------------------------
# Workbooks (xlsx / csv)
# --------------------------------------------------------------------------

async def plan_workbook(prose: str, user_prompt: str, model: str | None = None) -> Workbook:
    instruction = user_prompt.strip() or "Organize the source content into a clean, well-structured spreadsheet."
    basis = f"\n\nSOURCE CONTENT:\n{prose}" if prose.strip() else ""
    prompt = f"""You are a spreadsheet/data analyst. Output ONLY one JSON object — no prose, no fences.

USER REQUEST: "{instruction}"{basis}

Schema:
{{"title": "string", "sheets": [{{"name": "string", "headers": ["string"], "rows": [["string"]]}}]}}

Rules:
- 1 to {MAX_SHEETS} sheets. Every row must have exactly as many cells as "headers".
- Always produce real tabular structure with meaningful column headers — never put a whole sentence or paragraph in one cell when it can be split into columns (e.g. Item/Category/Amount/Date, or Task/Owner/Status/Deadline).
- If the source data is already tabular (rows/columns, a list of items with attributes, etc.), extract it faithfully.
- If the request or source is narrative with no obvious rows, derive a sensible breakdown (e.g. columns: Topic, Key Point, Detail) instead of dumping prose into a single column.
- Cell values are plain text/numbers only, no markdown formatting."""
    data = _extract_json(await _call_ollama(prompt, json_mode=True, temperature=0.25, model=model))
    return _normalize_workbook(data, instruction, prose)


def _normalize_workbook(data: Optional[dict], instruction: str, prose: str) -> Workbook:
    sheets_raw = data.get("sheets") if isinstance(data, dict) else None
    sheets = []
    if isinstance(sheets_raw, list):
        for s in sheets_raw[:MAX_SHEETS]:
            if not isinstance(s, dict):
                continue
            headers = [str(h) for h in (s.get("headers") or [])]
            rows = [[str(c) for c in r] for r in (s.get("rows") or []) if isinstance(r, list)]
            rows = [r for r in rows if len(r) == len(headers)] if headers else []
            if headers and rows:
                sheets.append(Sheet(name=str(s.get("name") or "Sheet1")[:31], headers=headers, rows=rows))
    if not sheets:
        return _fallback_workbook(instruction, prose)
    title = str(data.get("title") or instruction or "Generated Workbook")[:120]
    return Workbook(title=title, sheets=sheets)


def _fallback_workbook(instruction: str, prose: str) -> Workbook:
    if prose.strip():
        chunks = [c.strip() for c in re.split(r"\n\s*\n", prose.strip()) if c.strip()][:200]
        rows = [[str(i + 1), c[:500]] for i, c in enumerate(chunks)]
        return Workbook(
            title=(instruction or "Generated Workbook")[:120],
            sheets=[Sheet(name="Data", headers=["#", "Content"], rows=rows or [["1", prose[:500]]])],
        )
    return Workbook(
        title=(instruction or "Generated Workbook")[:120],
        sheets=[Sheet(name="Data", headers=["Note"], rows=[[f'Content for "{instruction}" could not be auto-planned.']])],
    )


def append_code_sheet(wb: Workbook, code_blocks: list) -> None:
    if not code_blocks:
        return
    rows = [[c["filename"], c["language"], str(c["content"].count("\n") + 1)] for c in code_blocks]
    wb.sheets.append(Sheet(name="Source Files", headers=["File", "Language", "Lines"], rows=rows))
