"""
Vision Mode — Phase 10.

/tools/vision/describe -> sends an uploaded image to Ollama's
multimodal /api/chat endpoint (qwen2.5vl:7b by default, gemma3:4b as a
lighter fallback if the primary model isn't pulled/available) and
returns the model's description as plain text. The frontend wraps this
as a { type: "document", text } attachment (see VisionButton.jsx), so
it flows into the assistant's context through the exact same path as
a PDF/DOCX extraction -- no chat-flow changes needed.

Shares routers/image.py's GPU semaphore: qwen2.5vl:7b is ~6GB on its
own, i.e. the whole 3050's VRAM, so it must never run concurrently
with ComfyUI generation/enhancement.
"""
import base64
import logging
from pathlib import Path

import httpx
from fastapi import APIRouter, UploadFile, File, Form, HTTPException

from gpu_manager import gpu_job, ollama_unload_others

router = APIRouter(prefix="/tools/vision", tags=["vision"])

logger = logging.getLogger("routers.vision")

OLLAMA_URL = "http://localhost:11434"
# Swapped Sep 2026: on a 6GB card with ~1.4GB already held by the
# backend's warmed enhance models, qwen2.5vl:7b (6.2GB) doesn't fit in
# VRAM and Ollama splits it ~60/40 CPU/GPU -- slow and loud. gemma3:4b
# (3.3GB) fits fully on GPU and is fast. qwen2.5vl:7b is still available
# by explicitly passing model="qwen2.5vl:7b" in the /describe request
# when its extra capability is worth the CPU-assisted slowdown.
VISION_MODEL = "gemma3:4b"
VISION_MODEL_FALLBACK = "qwen2.5vl:7b"  # heavier, more capable, but will likely CPU/GPU-split on this card

DEFAULT_PROMPT = (
    "Describe this image in detail. If it contains a chart or graph, "
    "state the axes, the trend, and any notable values. If it contains "
    "text (a screenshot or document), transcribe the important text "
    "accurately. If it's a UI screenshot, describe the layout and controls."
)

ALLOWED_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}

VISION_TIMEOUT_SECONDS = 300  # a 6GB VLM's first response after a cold load can take minutes


async def _describe_with_model(b64_image: str, prompt: str, model: str) -> str:
    async with httpx.AsyncClient(timeout=VISION_TIMEOUT_SECONDS) as client:
        res = await client.post(
            f"{OLLAMA_URL}/api/chat",
            json={
                "model": model,
                "messages": [{"role": "user", "content": prompt, "images": [b64_image]}],
                "stream": False,
                "keep_alive": "3m",  # stay warm for a few follow-up questions on the same image
                "options": {"num_ctx": 4096, "num_predict": 512},  # bounds worst-case generation time
            },
        )
        res.raise_for_status()
        data = res.json()
        return (data.get("message") or {}).get("content", "").strip()


@router.post("/describe")
async def describe_image(
    file: UploadFile = File(...),
    prompt: str = Form(DEFAULT_PROMPT),
    model: str = Form(VISION_MODEL),
):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXTS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image type: {ext or 'unknown'}. Use PNG, JPG, WEBP, GIF, or BMP.",
        )

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    b64_image = base64.b64encode(data).decode("ascii")

    async with gpu_job("vision-describe"):
        # Frees VRAM held by any *other* loaded Ollama model (e.g. a
        # chat model idling from a prior conversation) so the vision
        # model gets as much of the 6GB card as possible instead of
        # fighting another model for space and falling back to CPU.
        await ollama_unload_others(OLLAMA_URL, keep_model=model)
        try:
            text = await _describe_with_model(b64_image, prompt, model)
        except httpx.ConnectError:
            raise HTTPException(
                status_code=503,
                detail=f"Could not reach Ollama at {OLLAMA_URL}. Make sure it's running (ollama serve).",
            )
        except httpx.TimeoutException:
            raise HTTPException(
                status_code=504,
                detail=(
                    f"Vision model timed out after {VISION_TIMEOUT_SECONDS}s. "
                    "This usually happens on the very first request while the model cold-loads into VRAM -- "
                    "try again, it should be fast now that it's warm. If it keeps timing out, run "
                    "'ollama ps' during a request to confirm it's actually using the GPU, not the CPU."
                ),
            )
        except httpx.HTTPStatusError as e:
            if model != VISION_MODEL_FALLBACK:
                logger.warning("Vision model %s failed (%s), retrying with fallback %s", model, e, VISION_MODEL_FALLBACK)
                try:
                    text = await _describe_with_model(b64_image, prompt, VISION_MODEL_FALLBACK)
                    model = VISION_MODEL_FALLBACK
                except Exception as e2:
                    raise HTTPException(
                        status_code=502,
                        detail=f"Ollama vision request failed for both {VISION_MODEL} and {VISION_MODEL_FALLBACK}: {e2}",
                    )
            else:
                raise HTTPException(status_code=502, detail=f"Ollama vision request failed: {e}")

    if not text:
        raise HTTPException(status_code=502, detail="Vision model returned an empty description")

    logger.info("Vision describe: %s (%d bytes) via %s -> %d chars", file.filename, len(data), model, len(text))
    return {"filename": file.filename, "model": model, "text": text}
