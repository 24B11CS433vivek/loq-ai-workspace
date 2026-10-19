"""
Voice — Phase 11.

/tools/voice/transcribe -- an audio blob recorded in the browser
    (MediaRecorder, usually webm/opus) -> faster-whisper -> text.
/tools/voice/speak      -- text -> piper-tts -> a .wav file served
    back through the SAME /files static mount universal_generate.py
    already exposes (GENERATED_DIR below is the same physical
    directory as backend/generated/ used by the other routers).

Both models are lazy-loaded on first use and then cached in memory
(same pattern as image.py's _get_gfpgan/_get_realesrgan/_get_rembg_session).
Neither touches the shared GPU slot (gpu_manager.GPU): faster-whisper's
"small" model and piper's onnx voices are both fast enough on CPU that
voice features keep working at full speed even while ComfyUI or the
vision model are using the whole 6GB card. (faster-whisper CAN run on
CUDA -- set WHISPER_DEVICE=cuda -- but if you do, route it through
gpu_job() like vision.py does, since it would then be fighting
ComfyUI/vision for the same VRAM.)
"""
import asyncio
import json
import logging
import os
import re
import tempfile
import uuid
import wave
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from gpu_manager import gpu_job, ollama_unload_others

router = APIRouter(prefix="/tools/voice", tags=["voice"])

logger = logging.getLogger("routers.voice")

OLLAMA_URL = "http://localhost:11434"

BACKEND_DIR = Path(__file__).resolve().parent.parent
GENERATED_DIR = BACKEND_DIR / "generated"
GENERATED_DIR.mkdir(exist_ok=True)

# --- Speech-to-text (faster-whisper) ---------------------------------------

WHISPER_MODEL_SIZE = os.environ.get("WHISPER_MODEL_SIZE", "small")
WHISPER_DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")

_whisper_model = None


def _get_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel
        logger.info(
            "Loading faster-whisper model=%s device=%s compute_type=%s "
            "(first request only -- downloads weights from HF on first-ever run)",
            WHISPER_MODEL_SIZE, WHISPER_DEVICE, WHISPER_COMPUTE_TYPE,
        )
        _whisper_model = WhisperModel(
            WHISPER_MODEL_SIZE, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE_TYPE,
        )
    return _whisper_model


# Extensions MediaRecorder commonly produces, plus whatever else a user
# might upload directly. faster-whisper (via PyAV, which bundles its
# own ffmpeg) will happily try to decode anything regardless -- this is
# just used to pick a sane temp-file suffix.
KNOWN_AUDIO_EXTS = {".webm", ".ogg", ".oga", ".wav", ".m4a", ".mp3", ".mp4", ".flac"}


def _transcribe_blocking(tmp_path: str, language: Optional[str]):
    """Runs on a worker thread via asyncio.to_thread -- model loading
    (including the first-run HF download) and model.transcribe() are
    both blocking/CPU-bound and must never run directly on the event
    loop, or they freeze every other request (including /health) for
    as long as they take."""
    model = _get_whisper_model()
    segments, info = model.transcribe(tmp_path, language=language or None, vad_filter=True)
    text = "".join(seg.text for seg in segments).strip()
    return text, getattr(info, "language", None)


@router.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: Optional[str] = Form(None),  # e.g. "en" -- omit to auto-detect
):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded audio is empty")

    ext = Path(file.filename or "").suffix.lower()
    suffix = ext if ext in KNOWN_AUDIO_EXTS else ".webm"  # MediaRecorder defaults to webm

    tmp_path = None
    text = ""
    detected_language = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(data)
            tmp_path = tmp.name

        text, detected_language = await asyncio.to_thread(_transcribe_blocking, tmp_path, language)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Transcription failed")
        raise HTTPException(status_code=502, detail=f"Transcription failed: {e}")
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    if not text:
        raise HTTPException(
            status_code=502,
            detail="Could not make out any speech in that recording -- try again a bit closer to the mic.",
        )

    logger.info(
        "Voice transcribe: %s (%d bytes) -> %d chars, lang=%s",
        file.filename, len(data), len(text), detected_language or "?",
    )
    return {"text": text, "language": detected_language}


# --- Text-to-speech (piper-tts) --------------------------------------------

_MD_CODE_BLOCK_RE = re.compile(r"```.*?```", re.DOTALL)
_MD_INLINE_CODE_RE = re.compile(r"`[^`]*`")
_MD_LINK_RE = re.compile(r"\[([^\]]*)\]\([^)]*\)")
_MD_EMPHASIS_RE = re.compile(r"[*_~#>]+")
_SMART_PUNCT_MAP = {
    "\u2018": "'", "\u2019": "'",
    "\u201c": '"', "\u201d": '"',
    "\u2013": "-", "\u2014": "-",
    "\u2026": "...",
}


def _sanitize_for_tts(text: str) -> str:
    """AI-generated replies commonly contain markdown syntax and 'smart'
    typographic punctuation (em dashes, curly quotes, ellipsis chars)
    that this Piper voice's phoneme vocabulary doesn't cover -- feeding
    those straight to the model causes an ONNX GatherElements out-of-
    range crash deep in the decoder. Strip/normalize them first."""
    text = _MD_CODE_BLOCK_RE.sub(" ", text)
    text = _MD_INLINE_CODE_RE.sub(" ", text)
    text = _MD_LINK_RE.sub(r"\1", text)
    text = _MD_EMPHASIS_RE.sub(" ", text)
    for smart, plain in _SMART_PUNCT_MAP.items():
        text = text.replace(smart, plain)
    return re.sub(r"\s+", " ", text).strip()


PIPER_VOICES_DIR = Path(
    os.environ.get("PIPER_VOICES_DIR", str(Path(__file__).resolve().parent.parent / "voice_models"))
)
PIPER_DEFAULT_VOICE = os.environ.get("PIPER_VOICE", "en_US-lessac-medium")
# Telugu voice from the same rhasspy/piper-voices set as the English default --
# download once with: python -m piper.download_voices te_IN-padmavathi-medium --download-dir <PIPER_VOICES_DIR>
PIPER_TELUGU_VOICE = os.environ.get("PIPER_VOICE_TE", "te_IN-padmavathi-medium")
BUILTIN_PIPER_VOICES = [
    {"id": PIPER_DEFAULT_VOICE, "label": "English (US)", "lang": "en"},
    {"id": PIPER_TELUGU_VOICE, "label": "Telugu \u0c24\u0c46\u0c32\u0c41\u0c17\u0c41", "lang": "te"},
]
MAX_TTS_CHARS = 2000  # piper synthesizes sentence-by-sentence; cap so a long reply can't hang the request

_TELUGU_RE = re.compile(r"[\u0C00-\u0C7F]")


def _contains_telugu(text: str) -> bool:
    """Cheap script check (Telugu Unicode block) so /speak can auto-route
    Telugu text to a Telugu-capable voice instead of feeding it to the
    English Piper model (which garbles it) or to a cloned XTTS voice
    (which silently can't produce Telugu at all -- not in its 17
    supported languages)."""
    return bool(_TELUGU_RE.search(text))

_piper_voices = {}  # voice name -> loaded PiperVoice, cached per-voice


def _get_piper_voice(name: str):
    if name in _piper_voices:
        return _piper_voices[name]

    model_path = PIPER_VOICES_DIR / f"{name}.onnx"
    config_path = PIPER_VOICES_DIR / f"{name}.onnx.json"
    if not model_path.exists():
        raise HTTPException(
            status_code=503,
            detail=(
                f"Piper voice '{name}' not found at {model_path}. Download it once with: "
                f"python -m piper.download_voices {name} --download-dir {PIPER_VOICES_DIR}"
            ),
        )

    from piper.voice import PiperVoice
    logger.info("Loading Piper voice %s from %s", name, model_path)
    voice_obj = PiperVoice.load(str(model_path), config_path=str(config_path) if config_path.exists() else None)
    _piper_voices[name] = voice_obj
    return voice_obj


def _speak_blocking(text: str, voice: str, out_path: Path):
    """Runs on a worker thread via asyncio.to_thread -- same reasoning as
    _transcribe_blocking: Piper voice loading + synthesis are blocking,
    CPU-bound calls and must not run on the event loop directly."""
    piper_voice = _get_piper_voice(voice)
    chunk_count = 0
    with wave.open(str(out_path), "wb") as wav_file:
        params_set = False
        for chunk in piper_voice.synthesize(text):
            if not params_set:
                wav_file.setframerate(chunk.sample_rate)
                wav_file.setsampwidth(chunk.sample_width)
                wav_file.setnchannels(chunk.sample_channels)
                params_set = True
            wav_file.writeframes(chunk.audio_int16_bytes)
            chunk_count += 1

    if chunk_count == 0:
        # Piper's phonemizer produced nothing for this text (e.g. text
        # that's all markdown/code syntax with no speakable words, or an
        # unusual character sequence that breaks espeak's clause parser).
        # Without this check, wave.close() above raises a cryptic
        # "# channels not specified" instead of a diagnosable message.
        raise HTTPException(
            status_code=422,
            detail=(
                "Piper produced no audio for this text -- it may be all "
                "code/markdown syntax or contain characters espeak-ng "
                "can't phonemize. Try shorter, plain-text input."
            ),
        )


@router.post("/speak")
async def speak(
    text: str = Form(...),
    voice: str = Form(PIPER_DEFAULT_VOICE),
):
    text = text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="No text to speak")
    text = _sanitize_for_tts(text)[:MAX_TTS_CHARS]

    # Smart voice routing: a cloned voice (XTTS-v2) can't produce Telugu at
    # all (not one of its 17 supported languages) and the default English
    # Piper voice reads Telugu as garbled phonetic noise -- so Telugu text
    # always gets steered to the Telugu Piper voice, regardless of what was
    # requested, and the frontend is told why via `note`.
    is_telugu = _contains_telugu(text)
    used_voice = voice or PIPER_DEFAULT_VOICE
    note = None
    if used_voice.startswith("clone:") and is_telugu:
        note = "Cloned voices can't speak Telugu yet (XTTS-v2 doesn't support it) -- used the built-in Telugu voice instead."
        used_voice = PIPER_TELUGU_VOICE
    elif is_telugu and used_voice in (PIPER_DEFAULT_VOICE, "piper"):
        note = "Detected Telugu text -- used the Telugu voice."
        used_voice = PIPER_TELUGU_VOICE

    filename = f"speech-{uuid.uuid4().hex}.wav"
    out_path = GENERATED_DIR / filename
    try:
        if used_voice.startswith("clone:"):
            profile_id = used_voice.split(":", 1)[1]
            profile = next((p for p in _load_profiles() if p.get("id") == profile_id), None)
            if not profile:
                raise HTTPException(status_code=404, detail=f"Voice profile '{profile_id}' not found")
            sample_path = BACKEND_DIR / profile["sample_path"]
            async with gpu_job("voice-speak-clone"):
                await ollama_unload_others(OLLAMA_URL)  # XTTS wants headroom on the 6GB card too
                await asyncio.to_thread(_clone_blocking, text, "en", sample_path, out_path)
        else:
            await asyncio.to_thread(_speak_blocking, text, used_voice, out_path)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Speech synthesis failed")
        if out_path.exists():
            out_path.unlink(missing_ok=True)
        raise HTTPException(status_code=502, detail=f"Speech synthesis failed: {e}")

    logger.info("Voice speak: %d chars -> %s via %s", len(text), filename, used_voice)
    return {"filename": filename, "voice": used_voice, "note": note, "url": f"/files/{filename}"}


# --- Voice cloning (Coqui XTTS-v2, zero-shot) -------------------------------
#
# /tools/voice/clone takes a short reference sample (~15s) + text, saves
# the sample under backend/data/voices/ so it's reusable, and runs XTTS-v2's
# zero-shot speaker-cloning path -- no training/fine-tuning happens, the
# reference clip just conditions the fixed pretrained model at inference
# time. Profiles (name + sample path) persist in
# backend/data/voices/profiles.json so the frontend can list them.
#
# XTTS-v2 is a ~1.8GB multilingual model and wants the GPU, so it shares
# the SAME slot as ComfyUI/vision/enhance (gpu_manager.gpu_job) instead of
# its own semaphore, and falls back to CPU (slow, but it works) if CUDA
# isn't available -- same _pick_device() pattern as routers/image.py
# (duplicated locally rather than imported, so this router has no
# import-time dependency on image.py). Like the enhance models warmed in
# main.py, the loaded XTTS model stays cached (and holding GPU memory)
# after first use -- restart uvicorn to release it if you need the full
# 6GB back for a big ComfyUI job.

VOICES_DIR = BACKEND_DIR / "data" / "voices"
VOICES_DIR.mkdir(parents=True, exist_ok=True)
PROFILES_PATH = VOICES_DIR / "profiles.json"

KNOWN_SAMPLE_EXTS = {".webm", ".ogg", ".oga", ".wav", ".m4a", ".mp3", ".mp4", ".flac"}
MIN_SAMPLE_MS = 3000    # reject anything too short to carry a usable voiceprint
MAX_SAMPLE_MS = 60000   # trim anything absurdly long -- 15s is the target, this is just a ceiling

_xtts_model = None


def _pick_device() -> str:
    """Same probe as routers/image.py's _pick_device. Never raises -- if
    torch or CUDA isn't there, we just run on CPU instead of crashing."""
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


def _load_profiles() -> list:
    if not PROFILES_PATH.exists():
        return []
    try:
        return json.loads(PROFILES_PATH.read_text(encoding="utf-8"))
    except Exception:
        logger.warning("voice profiles.json is corrupt -- starting fresh", exc_info=True)
        return []


def _save_profiles(profiles: list):
    PROFILES_PATH.write_text(json.dumps(profiles, indent=2), encoding="utf-8")


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return slug or f"voice-{uuid.uuid4().hex[:8]}"


def _get_xtts():
    """Lazy-loaded and cached, same pattern as _get_whisper_model /
    _get_piper_voice above. First call downloads the model from the Coqui
    model hub (a few GB) -- that cost lands on whichever request happens
    to trigger it first, same trade routers/image.py makes for gfpgan."""
    global _xtts_model
    if _xtts_model is None:
        os.environ.setdefault("COQUI_TOS_AGREED", "1")  # non-interactive: skip the CLI TOS prompt
        from TTS.api import TTS
        device = _pick_device()
        logger.info("Loading XTTS-v2 on %s (first call only -- downloads weights on first-ever run)", device)
        _xtts_model = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(device)
    return _xtts_model


def _prep_sample_blocking(raw_bytes: bytes, suffix: str, dest_path: Path) -> float:
    """Runs on a worker thread. Decodes whatever was uploaded (webm/ogg/
    mp3/wav/...) via pydub+ffmpeg, converts to mono 24kHz wav (XTTS's
    native rate), trims to MAX_SAMPLE_MS, writes dest_path. Returns the
    final clip length in seconds."""
    from pydub import AudioSegment
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(raw_bytes)
        tmp_path = tmp.name
    try:
        audio = AudioSegment.from_file(tmp_path)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    if len(audio) < MIN_SAMPLE_MS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Sample is only {len(audio) / 1000:.1f}s -- need at least "
                f"{MIN_SAMPLE_MS / 1000:.0f}s for a usable voiceprint."
            ),
        )
    audio = audio[:MAX_SAMPLE_MS].set_channels(1).set_frame_rate(24000)
    audio.export(str(dest_path), format="wav")
    return len(audio) / 1000.0


def _clone_blocking(text: str, language: str, sample_path: Path, out_path: Path):
    """Runs on a worker thread -- XTTS model load (first call) + inference
    are both blocking, CPU/GPU-bound calls and must not run on the event
    loop directly, same reasoning as _transcribe_blocking/_speak_blocking."""
    tts = _get_xtts()
    tts.tts_to_file(text=text, speaker_wav=str(sample_path), language=language, file_path=str(out_path))


@router.post("/clone")
async def clone_voice(
    sample: UploadFile = File(...),
    text: str = Form(...),
    name: str = Form(...),
    language: str = Form("en"),
):
    name = name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Voice profile needs a name")

    text = text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="No text to speak")
    text = _sanitize_for_tts(text)[:MAX_TTS_CHARS]

    raw = await sample.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded sample is empty")
    ext = Path(sample.filename or "").suffix.lower()
    suffix = ext if ext in KNOWN_SAMPLE_EXTS else ".webm"

    slug = _slugify(name)
    sample_path = VOICES_DIR / f"{slug}.wav"

    try:
        duration_s = await asyncio.to_thread(_prep_sample_blocking, raw, suffix, sample_path)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Voice sample decode failed")
        raise HTTPException(status_code=400, detail=f"Could not decode that audio sample: {e}")

    filename = f"clone-{uuid.uuid4().hex}.wav"
    out_path = GENERATED_DIR / filename
    try:
        async with gpu_job("voice-clone"):
            await ollama_unload_others(OLLAMA_URL)  # XTTS wants headroom on the 6GB card too
            await asyncio.to_thread(_clone_blocking, text, language, sample_path, out_path)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Voice cloning failed")
        if out_path.exists():
            out_path.unlink(missing_ok=True)
        raise HTTPException(status_code=502, detail=f"Voice cloning failed: {e}")

    profiles = [p for p in _load_profiles() if p.get("id") != slug]
    profiles.append({
        "id": slug,
        "name": name,
        "sample_path": str(sample_path.relative_to(BACKEND_DIR)),
        "sample_seconds": round(duration_s, 1),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    _save_profiles(profiles)

    logger.info("Voice clone: profile=%s (%.1fs sample) -> %s", slug, duration_s, filename)
    return {
        "filename": filename,
        "url": f"/files/{filename}",
        "profile": {"id": slug, "name": name},
    }


@router.get("/clone/profiles")
async def list_voice_profiles():
    return {"profiles": _load_profiles()}


@router.delete("/clone/profiles/{profile_id}")
async def delete_voice_profile(profile_id: str):
    profiles = _load_profiles()
    match = next((p for p in profiles if p.get("id") == profile_id), None)
    if not match:
        raise HTTPException(status_code=404, detail=f"Voice profile '{profile_id}' not found")

    sample_path = BACKEND_DIR / match["sample_path"]
    try:
        sample_path.unlink(missing_ok=True)
    except OSError:
        logger.warning("Could not delete sample file for profile %s", profile_id, exc_info=True)

    remaining = [p for p in profiles if p.get("id") != profile_id]
    _save_profiles(remaining)

    logger.info("Voice clone profile deleted: %s", profile_id)
    return {"deleted": profile_id}


@router.get("/voices")
async def list_voices():
    """Combined list for the frontend's voice picker: built-in Piper
    voices (each flagged `available` depending on whether that .onnx has
    actually been downloaded yet) plus every cloned profile, already
    prefixed with `clone:` so the id can be passed straight back into
    /speak's `voice` field."""
    builtin = [
        {**v, "available": (PIPER_VOICES_DIR / f"{v['id']}.onnx").exists()}
        for v in BUILTIN_PIPER_VOICES
    ]
    clones = [
        {"id": f"clone:{p['id']}", "label": f"{p['name']} (cloned)", "lang": None}
        for p in _load_profiles()
    ]
    return {"builtin": builtin, "clones": clones}
