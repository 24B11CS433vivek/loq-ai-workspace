"""
Creative Studio — Phase 9.

/tools/image/generate  -> talks to a locally-running ComfyUI instance
                           (http://127.0.0.1:8188) and returns a saved PNG.
/tools/image/enhance    -> added in Phase 9b (gfpgan/realesrgan/rembg/color).

ComfyUI does all the actual diffusion work; this router just builds the
API-format workflow graph, submits it, polls /history until the image
node has output, downloads the bytes, and re-saves them into
GENERATED_DIR so they're served the same way docgen files already are
(via the /files static mount in main.py).
"""
import asyncio
import base64
import logging
import random
import uuid
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel

from gpu_manager import gpu_job, ollama_unload_others

router = APIRouter(prefix="/tools/image", tags=["image"])

logger = logging.getLogger("routers.image")

COMFYUI_URL = "http://127.0.0.1:8188"
OLLAMA_URL = "http://localhost:11434"

GENERATED_DIR = Path(__file__).resolve().parent.parent / "generated"
GENERATED_DIR.mkdir(exist_ok=True)


def _pick_device() -> str:
    """GPU-first, CPU-fallback device probe used by every in-process
    model below (ComfyUI /generate manages its own device separately).
    Never raises -- if torch or CUDA isn't there, we just run on CPU
    instead of crashing the request."""
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


# /generate (ComfyUI, its own process) and /enhance (gfpgan/realesrgan/
# rembg loaded in *this* process) both end up touching the same 6GB
# card. Phase 11: coordination moved to gpu_manager.gpu_job, a single
# slot SHARED with routers/vision.py too, instead of a semaphore local
# to this file -- a vision request and an image job could otherwise
# have run concurrently, since they used to hold separate locks.
ENHANCE_TIMEOUT_SECONDS = 120  # hard ceiling -- with models warmed at startup, this now covers actual inference time only

CHECKPOINTS = {
    "illustrative": "dreamshaper8.safetensors",
    "realistic": "realisticVisionV60.safetensors",
    "cyberrealistic": "cyberrealistic.safetensors",
}

DEFAULT_NEGATIVE = (
    "text, watermark, signature, low quality, blurry, deformed, "
    "extra limbs, bad anatomy, worst quality"
)

# The 3050's 6GB VRAM can't run image gen alongside another heavy job
# (a 7B chat model, upscaling, etc.) — same one-at-a-time reasoning as
# GEN_SEMAPHORE in universal_generate.py, just scoped to this router.
IMAGE_TIMEOUT_SECONDS = 180
POLL_INTERVAL_SECONDS = 1.0


class GenerateRequest(BaseModel):
    prompt: str
    style: str = "illustrative"   # "illustrative" | "realistic"
    negative_prompt: str | None = None
    width: int = 512
    height: int = 512
    steps: int = 22
    seed: int | None = None


def _build_workflow(req: GenerateRequest) -> dict:
    checkpoint = CHECKPOINTS.get(req.style, CHECKPOINTS["illustrative"])
    seed = req.seed if req.seed is not None else random.randint(0, 2**32 - 1)
    return {
        "4": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": checkpoint},
        },
        "5": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": req.width, "height": req.height, "batch_size": 1},
        },
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": req.prompt, "clip": ["4", 1]},
        },
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": req.negative_prompt or DEFAULT_NEGATIVE, "clip": ["4", 1]},
        },
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed,
                "steps": req.steps,
                "cfg": 7.0,
                "sampler_name": "euler",
                "scheduler": "normal",
                "denoise": 1.0,
                "model": ["4", 0],
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["5", 0],
            },
        },
        "8": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["3", 0], "vae": ["4", 2]},
        },
        "9": {
            "class_type": "SaveImage",
            "inputs": {"filename_prefix": "loq_gen", "images": ["8", 0]},
        },
    }


async def _submit_and_wait(client: httpx.AsyncClient, workflow: dict, client_id: str) -> dict:
    submit = await client.post(
        f"{COMFYUI_URL}/prompt",
        json={"prompt": workflow, "client_id": client_id},
        timeout=30,
    )
    if submit.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"ComfyUI rejected the workflow ({submit.status_code}): {submit.text[:300]}",
        )
    prompt_id = submit.json().get("prompt_id")
    if not prompt_id:
        raise HTTPException(status_code=502, detail="ComfyUI didn't return a prompt_id")

    waited = 0.0
    while waited < IMAGE_TIMEOUT_SECONDS:
        hist = await client.get(f"{COMFYUI_URL}/history/{prompt_id}", timeout=15)
        if hist.status_code == 200:
            data = hist.json().get(prompt_id)
            if data and data.get("outputs"):
                return data["outputs"]
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
        waited += POLL_INTERVAL_SECONDS

    raise HTTPException(
        status_code=504,
        detail=f"ComfyUI generation timed out after {IMAGE_TIMEOUT_SECONDS}s",
    )


@router.post("/generate")
async def generate_image(req: GenerateRequest):
    if not req.prompt.strip():
        raise HTTPException(status_code=400, detail="prompt is required")
    if req.style not in CHECKPOINTS:
        raise HTTPException(status_code=400, detail=f"style must be one of {list(CHECKPOINTS)}")

    workflow = _build_workflow(req)
    client_id = str(uuid.uuid4())

    async with gpu_job("image-generate"):
        await ollama_unload_others(OLLAMA_URL)  # ComfyUI wants the whole card -- free any loaded chat/vision model first
        async with httpx.AsyncClient() as client:
            try:
                outputs = await _submit_and_wait(client, workflow, client_id)
            except httpx.ConnectError:
                raise HTTPException(
                    status_code=503,
                    detail=(
                        f"Could not reach ComfyUI at {COMFYUI_URL}. "
                        "Make sure it's running (cd ~/ComfyUI && python main.py)."
                    ),
                )

            images = outputs.get("9", {}).get("images", [])
            if not images:
                raise HTTPException(status_code=502, detail="ComfyUI returned no image output")
            img = images[0]

            view = await client.get(
                f"{COMFYUI_URL}/view",
                params={"filename": img["filename"], "subfolder": img.get("subfolder", ""), "type": img.get("type", "output")},
                timeout=30,
            )
            if view.status_code != 200:
                raise HTTPException(status_code=502, detail="Failed to fetch generated image from ComfyUI")

            out_name = f"image-{uuid.uuid4().hex[:8]}.png"
            out_path = GENERATED_DIR / out_name
            out_path.write_bytes(view.content)

    logger.info("Generated image %s (style=%s, prompt=%r)", out_name, req.style, req.prompt[:80])
    return {
        "filename": out_name,
        "url": f"/files/{out_name}",
        "style": req.style,
        "prompt": req.prompt,
        "width": req.width,
        "height": req.height,
    }


# ── Phase 9b — Enhance chain ────────────────────────────────────────
# gfpgan (face fix) -> realesrgan (upscale) -> rembg (bg removal) ->
# pillow (color grade). Each step is optional via a flag on the
# request; steps run in that fixed order when enabled. Models are
# loaded lazily and cached at module level so repeated requests don't
# reload weights from disk every time.

from io import BytesIO

import numpy as np
from PIL import Image, ImageEnhance

# Cached per-device so a GPU->CPU fallback doesn't have to reload
# weights from disk every single time it happens.
_gfpgan_instances = {}      # device -> GFPGANer
_realesrgan_instances = {}  # device -> RealESRGANer
_rembg_sessions = {}        # device -> onnxruntime session


def _get_gfpgan(device: str):
    if device not in _gfpgan_instances:
        from gfpgan import GFPGANer
        # GFPGANer auto-downloads the weights to ./gfpgan/weights on
        # first use if they aren't already present locally.
        _gfpgan_instances[device] = GFPGANer(
            model_path="https://github.com/TencentARC/GFPGAN/releases/download/v1.3.0/GFPGANv1.4.pth",
            upscale=1,
            arch="clean",
            channel_multiplier=2,
            bg_upsampler=None,
            device=device,
        )
    return _gfpgan_instances[device]


def _get_realesrgan(device: str):
    if device not in _realesrgan_instances:
        from basicsr.archs.rrdbnet_arch import RRDBNet
        from realesrgan import RealESRGANer
        model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=4)
        _realesrgan_instances[device] = RealESRGANer(
            scale=4,
            model_path="https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth",
            model=model,
            tile=256,       # tiled inference — keeps VRAM use sane on a 6GB card
            tile_pad=10,
            pre_pad=0,
            # fp16 needs CUDA -- forcing half=True unconditionally used
            # to break the CPU-fallback path entirely (it would error
            # out or silently NaN on CPU instead of just being slower).
            half=(device == "cuda"),
            device=device,
        )
    return _realesrgan_instances[device]


def _get_rembg_session(device: str):
    if device not in _rembg_sessions:
        from rembg import new_session
        providers = (
            ["CUDAExecutionProvider", "CPUExecutionProvider"]
            if device == "cuda"
            else ["CPUExecutionProvider"]
        )
        _rembg_sessions[device] = new_session("isnet-general-use", providers=providers)
    return _rembg_sessions[device]


# Every one of these three tries the GPU first (fast) and, if that
# throws for any reason (no CUDA, driver hiccup, VRAM OOM while
# something else is loaded), transparently retries once on CPU instead
# of taking the whole /enhance request down with it.

def _face_fix(img_bgr: np.ndarray) -> np.ndarray:
    device = _pick_device()
    try:
        restorer = _get_gfpgan(device)
        _, _, restored = restorer.enhance(img_bgr, has_aligned=False, only_center_face=False, paste_back=True)
        return restored
    except Exception:
        if device == "cpu":
            raise
        logger.warning("GFPGAN failed on GPU, falling back to CPU", exc_info=True)
        restorer = _get_gfpgan("cpu")
        _, _, restored = restorer.enhance(img_bgr, has_aligned=False, only_center_face=False, paste_back=True)
        return restored


def _upscale(img_bgr: np.ndarray, factor: int) -> np.ndarray:
    device = _pick_device()
    try:
        upsampler = _get_realesrgan(device)
        output, _ = upsampler.enhance(img_bgr, outscale=factor)
        return output
    except Exception:
        if device == "cpu":
            raise
        logger.warning("Real-ESRGAN failed on GPU, falling back to CPU", exc_info=True)
        upsampler = _get_realesrgan("cpu")
        output, _ = upsampler.enhance(img_bgr, outscale=factor)
        return output


def _remove_bg(png_bytes: bytes) -> bytes:
    from rembg import remove
    device = _pick_device()
    try:
        session = _get_rembg_session(device)
        return remove(png_bytes, session=session)
    except Exception:
        if device == "cpu":
            raise
        logger.warning("rembg failed on GPU, falling back to CPU", exc_info=True)
        session = _get_rembg_session("cpu")
        return remove(png_bytes, session=session)


def _color_grade(pil_img: Image.Image) -> Image.Image:
    # Deterministic auto-grade (no ML model): a mild contrast + saturation
    # + brightness lift, in that order — cheap and fast on CPU.
    out = ImageEnhance.Contrast(pil_img).enhance(1.12)
    out = ImageEnhance.Color(out).enhance(1.08)
    out = ImageEnhance.Brightness(out).enhance(1.02)
    return out


class EnhanceRequest(BaseModel):
    filename: str              # an existing file in GENERATED_DIR (e.g. from /generate)
    face_fix: bool = False
    upscale: bool = False
    upscale_factor: int = 2    # 2 or 4
    remove_bg: bool = False
    color_grade: bool = False


# Upload mode — user provides their own photo instead of generating one.
# Saves straight into GENERATED_DIR under a fresh name so the existing
# /enhance endpoint (face fix / upscale / remove bg / color grade) and
# /files static mount work on it identically to a ComfyUI-generated PNG.
ALLOWED_UPLOAD_EXTS = {".png", ".jpg", ".jpeg", ".webp"}


# Generated images are always a fixed 512x512 (see GenerateRequest
# defaults), so the enhance chain (gfpgan/realesrgan/rembg) is fast on
# them. A real phone photo can be 3000x4000+ -- every enhance step
# scales with pixel count, so an unresized upload can take 10-50x
# longer through the identical pipeline. Downscaling here (once, at
# upload time) keeps both paths in the same performance ballpark
# without touching the enhance code at all.
UPLOAD_MAX_DIMENSION = 1024


@router.post("/upload")
async def upload_image(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_UPLOAD_EXTS:
        raise HTTPException(status_code=400, detail=f"Unsupported image type: {ext or 'unknown'}. Use PNG, JPG, or WEBP.")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    def _prepare() -> bytes:
        img = Image.open(BytesIO(data)).convert("RGB")
        w, h = img.size
        longest = max(w, h)
        if longest > UPLOAD_MAX_DIMENSION:
            scale = UPLOAD_MAX_DIMENSION / longest
            img = img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
            logger.info("Resized upload %s from %dx%d to %dx%d for enhance-chain performance", file.filename, w, h, img.width, img.height)
        buf = BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()

    png_bytes = await asyncio.to_thread(_prepare)

    out_name = f"upload-{uuid.uuid4().hex[:8]}.png"
    out_path = GENERATED_DIR / out_name
    out_path.write_bytes(png_bytes)

    logger.info("Uploaded %s -> %s", file.filename, out_name)
    return {"filename": out_name, "url": f"/files/{out_name}"}


@router.post("/enhance")
async def enhance_image(req: EnhanceRequest):
    src_path = GENERATED_DIR / req.filename
    if not src_path.exists():
        raise HTTPException(status_code=404, detail=f"No generated file named {req.filename}")
    if req.upscale_factor not in (2, 4):
        raise HTTPException(status_code=400, detail="upscale_factor must be 2 or 4")
    if not any([req.face_fix, req.upscale, req.remove_bg, req.color_grade]):
        raise HTTPException(status_code=400, detail="Enable at least one enhancement step")

    # Applied to every source (upload, generated, or anything added
    # later) so no single image -- regardless of where it came from --
    # can push the enhance chain into multi-minute processing. Chosen
    # to keep face-fix/upscale/remove-bg/color-grade timing in the
    # same ballpark as a 512x512 generated image.
    MAX_ENHANCE_INPUT = 1024
    MAX_ENHANCE_OUTPUT = 2048

    def _run_chain() -> bytes:
        pil_img = Image.open(src_path).convert("RGB")
        w, h = pil_img.size
        longest = max(w, h)
        if longest > MAX_ENHANCE_INPUT:
            scale = MAX_ENHANCE_INPUT / longest
            pil_img = pil_img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
            logger.info("Enhance: downscaled %s from %dx%d to %dx%d before processing", req.filename, w, h, pil_img.width, pil_img.height)

        arr_bgr = np.array(pil_img)[:, :, ::-1].copy()  # RGB -> BGR for gfpgan/realesrgan

        if req.face_fix:
            arr_bgr = _face_fix(arr_bgr)
        if req.upscale:
            effective_factor = req.upscale_factor
            pre_h, pre_w = arr_bgr.shape[:2]
            while effective_factor > 1 and max(pre_w, pre_h) * effective_factor > MAX_ENHANCE_OUTPUT:
                effective_factor -= 1
            if effective_factor != req.upscale_factor:
                logger.info("Enhance: clamped upscale factor %sx -> %sx to stay under %dpx output", req.upscale_factor, effective_factor, MAX_ENHANCE_OUTPUT)
            if effective_factor >= 1:
                arr_bgr = _upscale(arr_bgr, max(effective_factor, 1))

        pil_img = Image.fromarray(arr_bgr[:, :, ::-1])  # BGR -> RGB

        if req.color_grade:
            pil_img = _color_grade(pil_img)

        buf = BytesIO()
        pil_img.save(buf, format="PNG")
        png_bytes = buf.getvalue()

        if req.remove_bg:
            png_bytes = _remove_bg(png_bytes)

        return png_bytes

    async with gpu_job("image-enhance"):
        await ollama_unload_others(OLLAMA_URL)  # gfpgan/realesrgan/rembg want the whole card -- free any loaded chat/vision model first
        try:
            # CPU/GPU-bound torch + PIL work — keep it off the event loop,
            # and bound it so a stuck model call fails the request instead
            # of hanging it (and the shared GPU slot) forever.
            png_bytes = await asyncio.wait_for(asyncio.to_thread(_run_chain), timeout=ENHANCE_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            raise HTTPException(
                status_code=504,
                detail=f"Enhancement timed out after {ENHANCE_TIMEOUT_SECONDS}s",
            )
        except ImportError as e:
            raise HTTPException(
                status_code=500,
                detail=f"Missing enhancement dependency: {e}. Expected gfpgan/realesrgan/rembg to already be installed.",
            )
        except Exception as e:
            logger.exception("Enhance chain failed for %s", req.filename)
            raise HTTPException(status_code=500, detail=f"Enhancement failed: {e}")

    out_name = f"enhanced-{uuid.uuid4().hex[:8]}.png"
    out_path = GENERATED_DIR / out_name
    out_path.write_bytes(png_bytes)

    steps = [s for s, on in [
        ("face_fix", req.face_fix), ("upscale", req.upscale),
        ("remove_bg", req.remove_bg), ("color_grade", req.color_grade),
    ] if on]
    logger.info("Enhanced %s -> %s (steps=%s)", req.filename, out_name, steps)
    return {"filename": out_name, "url": f"/files/{out_name}", "source": req.filename, "steps": steps}


# ── Image Edit — prompt-guided edit of an existing/uploaded photo ──
# Uses ComfyUI img2img: the source PNG is uploaded into ComfyUI's own
# input folder, then run through the SAME checkpoints already on disk
# (dreamshaper8 / realisticVision) with KSampler denoise < 1.0 instead
# of the fresh-latent txt2img path in _build_workflow. Lower denoise =
# closer to the original photo; higher = follows the prompt more and
# departs further from the source. No new models/downloads needed --
# this reuses everything /generate already has warmed on the 3050.
class EditRequest(BaseModel):
    filename: str                 # existing file in GENERATED_DIR (upload or prior generate/edit)
    prompt: str                   # what to change, e.g. "make it look like sunset, warm tones"
    style: str = "realistic"
    strength: float = 0.55        # 0.05-0.95 denoise; ~0.35 light touch-up, ~0.6-0.7 heavier edit
    steps: int = 30               # was 22 -- dpmpp_2m/karras wants a few more steps to fully resolve
    seed: int | None = None
    auto_caption: bool = True     # Tier 1: caption the source photo with a vision model first, so
                                   # the edit prompt is grounded in what's actually in frame instead
                                   # of only knowing your edit instruction and nothing else.
    use_controlnet: bool = True   # Tier 2: canny ControlNet locks the photo's structure/composition
                                   # so the edit only changes what the prompt asks for.
    controlnet_strength: float = 0.7  # 0-1; higher = structure stays closer to the original edges


# Tier 1 -- caption fusion. gemma3:4b (already installed, fits fully in
# VRAM per vision.py's own notes) captions the source photo before the
# edit prompt is built, so the model isn't editing "blind" -- it knows
# what's actually in frame and is less likely to drift things you
# didn't ask about. Best-effort: if captioning fails for any reason
# (Ollama down, model not pulled, timeout), we fall back to the plain
# edit prompt rather than failing the whole request.
CAPTION_MODEL = "gemma3:4b"
CAPTION_PROMPT = (
    "Describe this photo in one short factual sentence -- the main "
    "subject, setting, and visible details. No opinions, no flowery "
    "language, just what's there."
)
CAPTION_TIMEOUT_SECONDS = 45

# Tier 2 -- ControlNet. Filename must match whatever you placed in
# ComfyUI/models/controlnet/ (see this script's header for the download link).
CANNY_CONTROLNET_FILE = "canny_sd15.safetensors"


async def _caption_image(b64_image: str) -> str:
    async with httpx.AsyncClient(timeout=CAPTION_TIMEOUT_SECONDS) as client:
        res = await client.post(
            f"{OLLAMA_URL}/api/chat",
            json={
                "model": CAPTION_MODEL,
                "messages": [{"role": "user", "content": CAPTION_PROMPT, "images": [b64_image]}],
                "stream": False,
                "keep_alive": 0,  # don't hold VRAM after this one call -- ComfyUI needs the card next
                "options": {"num_ctx": 2048, "num_predict": 120},
            },
        )
        res.raise_for_status()
        data = res.json()
        return (data.get("message") or {}).get("content", "").strip()


def _build_edit_workflow(req: "EditRequest", comfy_image_name: str, prompt_text: str) -> dict:
    checkpoint = CHECKPOINTS.get(req.style, CHECKPOINTS["realistic"])
    seed = req.seed if req.seed is not None else random.randint(0, 2**32 - 1)
    denoise = max(0.05, min(req.strength, 0.95))

    workflow = {
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": checkpoint}},
        "10": {"class_type": "LoadImage", "inputs": {"image": comfy_image_name}},
        "11": {"class_type": "VAEEncode", "inputs": {"pixels": ["10", 0], "vae": ["4", 2]}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt_text, "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": DEFAULT_NEGATIVE, "clip": ["4", 1]}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "loq_edit", "images": ["8", 0]}},
    }

    positive_input = ["6", 0]
    if req.use_controlnet:
        # Canny edge map of the SOURCE photo -> ControlNet -> folded into the
        # positive conditioning. This is what keeps the edit from repainting
        # the whole image: the sampler is steered to respect the original
        # edges/composition no matter how strong the prompt pulls elsewhere.
        workflow["12"] = {"class_type": "Canny", "inputs": {"image": ["10", 0], "low_threshold": 0.4, "high_threshold": 0.8}}
        workflow["13"] = {"class_type": "ControlNetLoader", "inputs": {"control_net_name": CANNY_CONTROLNET_FILE}}
        workflow["14"] = {
            "class_type": "ControlNetApply",
            "inputs": {
                "conditioning": ["6", 0],
                "control_net": ["13", 0],
                "image": ["12", 0],
                "strength": max(0.0, min(req.controlnet_strength, 1.0)),
            },
        }
        positive_input = ["14", 0]

    workflow["3"] = {
        "class_type": "KSampler",
        "inputs": {
            "seed": seed,
            "steps": req.steps,
            "cfg": 7.0,
            "sampler_name": "dpmpp_2m",   # was euler -- sharper/more faithful at the same step count
            "scheduler": "karras",         # was normal -- pairs with dpmpp_2m, better fine detail
            "denoise": denoise,
            "model": ["4", 0],
            "positive": positive_input,
            "negative": ["7", 0],
            "latent_image": ["11", 0],
        },
    }
    return workflow


@router.post("/edit")
async def edit_image(req: EditRequest):
    if not req.prompt.strip():
        raise HTTPException(status_code=400, detail="prompt is required")
    src_path = GENERATED_DIR / req.filename
    if not src_path.exists():
        raise HTTPException(status_code=404, detail=f"No file named {req.filename}")
    if req.style not in CHECKPOINTS:
        raise HTTPException(status_code=400, detail=f"style must be one of {list(CHECKPOINTS)}")

    client_id = str(uuid.uuid4())
    img_bytes = src_path.read_bytes()

    async with gpu_job("image-edit"):
        prompt_text = req.prompt
        caption = None
        if req.auto_caption:
            await ollama_unload_others(OLLAMA_URL, keep_model=CAPTION_MODEL)
            try:
                b64_image = base64.b64encode(img_bytes).decode("ascii")
                caption = await _caption_image(b64_image)
                if caption:
                    prompt_text = f"Photo shows: {caption}\nEdit instruction: {req.prompt}"
            except Exception as e:
                # Best-effort: captioning is an accuracy boost, not a
                # requirement. Log and fall back to the plain prompt
                # rather than failing the whole edit over it.
                logger.warning("Auto-caption failed, continuing without it: %s", e)

        await ollama_unload_others(OLLAMA_URL)  # frees the caption model too -- ComfyUI wants the whole card
        async with httpx.AsyncClient() as client:
            try:
                upload_resp = await client.post(
                    f"{COMFYUI_URL}/upload/image",
                    files={"image": (src_path.name, img_bytes, "image/png")},
                    data={"overwrite": "true"},
                    timeout=30,
                )
            except httpx.ConnectError:
                raise HTTPException(
                    status_code=503,
                    detail=(
                        f"Could not reach ComfyUI at {COMFYUI_URL}. "
                        "Make sure it's running (cd ~/ComfyUI && python main.py)."
                    ),
                )
            if upload_resp.status_code != 200:
                raise HTTPException(
                    status_code=502,
                    detail=f"ComfyUI rejected the source image upload ({upload_resp.status_code}): {upload_resp.text[:300]}",
                )
            comfy_image_name = upload_resp.json().get("name", src_path.name)

            workflow = _build_edit_workflow(req, comfy_image_name, prompt_text)
            try:
                outputs = await _submit_and_wait(client, workflow, client_id)
            except httpx.ConnectError:
                raise HTTPException(status_code=503, detail=f"Could not reach ComfyUI at {COMFYUI_URL}.")

            images = outputs.get("9", {}).get("images", [])
            if not images:
                raise HTTPException(status_code=502, detail="ComfyUI returned no image output")
            img = images[0]

            view = await client.get(
                f"{COMFYUI_URL}/view",
                params={"filename": img["filename"], "subfolder": img.get("subfolder", ""), "type": img.get("type", "output")},
                timeout=30,
            )
            if view.status_code != 200:
                raise HTTPException(status_code=502, detail="Failed to fetch edited image from ComfyUI")

            out_name = f"edit-{uuid.uuid4().hex[:8]}.png"
            out_path = GENERATED_DIR / out_name
            out_path.write_bytes(view.content)

    logger.info(
        "Edited %s -> %s (prompt=%r, caption=%r, controlnet=%s, strength=%s)",
        req.filename, out_name, req.prompt[:80], (caption or "")[:80], req.use_controlnet, req.strength,
    )
    return {
        "filename": out_name,
        "url": f"/files/{out_name}",
        "source": req.filename,
        "prompt": req.prompt,
        "caption": caption,
        "style": req.style,
        "strength": req.strength,
        "controlnet": req.use_controlnet,
    }
