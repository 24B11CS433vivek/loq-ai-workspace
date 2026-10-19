"""
SVG Studio -- Phase 19A.

One endpoint: POST /tools/svg/generate {prompt, style} -> forwards a
tight system prompt to Ollama's qwen2.5-coder:7b and returns just the
raw <svg>...</svg> markup. No ComfyUI, no image file -- rendered
inline by the frontend via dangerouslySetInnerHTML.
"""
import re

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/tools/svg", tags=["svg"])

OLLAMA_URL = "http://localhost:11434"
# Fallback only -- used if the caller (frontend Settings -> SVG model)
# doesn't send a model. Any locally installed Ollama model can be
# passed in body.model instead; nothing is hardcoded anymore.
SVG_MODEL = "qwen2.5-coder:7b"

STYLE_GUIDANCE = {
    "icon": "A single-subject icon: simple, centered, works at 24-48px, minimal detail.",
    "logo": "A brandmark/logo: bold, memorable, very few shapes, must read clearly at tiny sizes.",
    "illustration": "A richer illustration: more detail, scene or composition, can use several colors and layers.",
    "badge": "A circular or shield-shaped badge/emblem: a border ring or frame, centered emblem, balanced symmetric layout.",
}

SYSTEM_PROMPT = (
    "You are an SVG generator. Output ONLY raw SVG code, starting with "
    "<svg and ending with </svg>. No explanation, no markdown code "
    "fences, no comments outside the tags. Flat design, modern, "
    "minimal, viewBox=\"0 0 400 400\"."
)

# Phase 19B -- "thinking" pass. Run before generation, on the same
# model, to get a short design brief (layout/shapes/colors) grounded
# in the requested style. This works with any model (no dependency on
# native reasoning/thinking support) since it's just a first plain-text
# chat turn whose output is fed back in as extra context for the real
# SVG-generation call below.
THINK_SYSTEM_PROMPT = (
    "You are an SVG design planner. Given a subject and a style, write "
    "a short design brief (3-6 bullet points, plain text, no SVG code) "
    "covering: composition/layout, the concrete shapes to use, a small "
    "color palette (hex codes), and how the style should shape the "
    "result. Be concrete and specific, not generic."
)

_SVG_RE = re.compile(r"<svg[\s\S]*?</svg>", re.IGNORECASE)


class SvgGenerateBody(BaseModel):
    prompt: str
    style: str = "icon"
    # Model preset chosen in Settings -- any model already pulled in
    # Ollama works, not just qwen2.5-coder.
    model: str | None = None
    # Run the design-brief "thinking" pass first. Defaults on since it
    # measurably improves results; the frontend exposes no toggle for
    # it today but the flag exists so it can be turned off per-request.
    think: bool = True


async def _ollama_chat(client: httpx.AsyncClient, model: str, messages: list[dict]) -> str:
    res = await client.post(
        f"{OLLAMA_URL}/api/chat",
        json={"model": model, "messages": messages, "stream": False},
    )
    res.raise_for_status()
    return res.json().get("message", {}).get("content", "")


@router.post("/generate")
async def svg_generate(body: SvgGenerateBody):
    if not body.prompt or not body.prompt.strip():
        raise HTTPException(400, "prompt is required")

    model = (body.model or SVG_MODEL).strip() or SVG_MODEL
    subject = body.prompt.strip()
    style_note = STYLE_GUIDANCE.get(body.style, STYLE_GUIDANCE["icon"])

    plan = ""
    try:
        async with httpx.AsyncClient(timeout=180) as client:
            if body.think:
                think_prompt = (
                    f"Style: {body.style} -- {style_note}\nSubject: {subject}"
                )
                try:
                    plan = await _ollama_chat(
                        client,
                        model,
                        [
                            {"role": "system", "content": THINK_SYSTEM_PROMPT},
                            {"role": "user", "content": think_prompt},
                        ],
                    )
                except httpx.HTTPStatusError:
                    # Thinking pass is a best-effort quality boost --
                    # if it fails for any reason, fall through and
                    # generate directly from the raw prompt instead of
                    # failing the whole request.
                    plan = ""

            user_prompt = f"Style: {body.style} -- {style_note}\nSubject: {subject}"
            if plan.strip():
                user_prompt += f"\n\nDesign brief to follow:\n{plan.strip()}"

            raw = await _ollama_chat(
                client,
                model,
                [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
            )
    except httpx.RequestError as e:
        raise HTTPException(503, f"Could not reach Ollama at {OLLAMA_URL}: {e}")
    except httpx.HTTPStatusError as e:
        raise HTTPException(502, f"Ollama rejected model '{model}': {e}")

    match = _SVG_RE.search(raw)
    if not match:
        raise HTTPException(502, f"Model did not return valid SVG. Raw output: {raw[:300]}")

    return {"svg_code": match.group(0), "plan": plan.strip(), "model": model}