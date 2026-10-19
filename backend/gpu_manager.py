"""
Unified GPU/CPU resource manager -- Phase 11.

Every heavy backend-mediated job (ComfyUI image generate/enhance,
Ollama vision describe, and any future GPU-bound tool) goes through
this single module instead of each router keeping its own semaphore.
That buys three things a per-router semaphore can't:

1. ONE shared slot across ALL routers -- a vision request and an
   image-generate request can never run concurrently no matter which
   router started first. Before this, each router had its OWN
   semaphore (routers/image.py's IMAGE_GPU_SEMAPHORE, imported into
   vision.py); that only worked by accident because there was just one
   heavy router at a time. A second independent one (vision) sharing
   the same 6GB card needed to share the same lock, not get its own.

2. Wait-with-timeout instead of instant rejection -- a request now
   politely queues for a short grace window instead of hard-failing
   with 429 the instant two requests land milliseconds apart.

3. Crash-proof + self-healing -- acquire/release always goes through
   the `gpu_job` async context manager, so any exception anywhere
   inside still releases the slot (Python guarantees __aexit__ runs).
   On top of that, /system/gpu-status exposes what's currently holding
   it and for how long, and /system/gpu-reset can force-clear a stuck
   slot without restarting uvicorn, in case a future bug ever manages
   to violate guarantee #3 anyway.

Scope note: the frontend's normal chat flow talks to Ollama directly
from the browser (src/lib/ollama.js), bypassing this backend entirely
by design (Phase 1 architecture) -- this manager only coordinates
backend-mediated heavy jobs. Ollama still serializes model loads for
direct chat requests on its own.
"""
import asyncio
import logging
import time

import httpx
from fastapi import HTTPException

logger = logging.getLogger("gpu_manager")

DEFAULT_WAIT_SECONDS = 8.0    # how long a new job politely queues before giving up
STUCK_JOB_WARN_SECONDS = 240  # log a warning if a job holds the slot this long


class _GPUSlot:
    def __init__(self):
        self._locked = False
        self._job_name = None
        self._started_at = None
        self._guard = asyncio.Lock()  # protects the bookkeeping above, not the GPU itself

    async def acquire(self, job_name: str, wait_seconds: float = DEFAULT_WAIT_SECONDS):
        deadline = time.monotonic() + wait_seconds
        while True:
            async with self._guard:
                if not self._locked:
                    self._locked = True
                    self._job_name = job_name
                    self._started_at = time.monotonic()
                    return
                current_job, elapsed = self._job_name, self._elapsed()
            if time.monotonic() >= deadline:
                raise HTTPException(
                    status_code=429,
                    detail=(
                        f"GPU is busy running '{current_job}' ({elapsed:.0f}s so far) -- "
                        "please retry shortly. Only one heavy job runs at a time on this GPU."
                    ),
                )
            await asyncio.sleep(0.2)

    def release(self):
        self._locked = False
        self._job_name = None
        self._started_at = None

    def _elapsed(self):
        return time.monotonic() - self._started_at if self._started_at else 0.0

    def status(self):
        return {
            "busy": self._locked,
            "job": self._job_name,
            "elapsed_seconds": round(self._elapsed(), 1) if self._locked else 0,
        }

    def force_release(self):
        was = self.status()
        self.release()
        return was


GPU = _GPUSlot()


class gpu_job:
    """Async context manager: `async with gpu_job("vision-describe"):`
    Always releases the shared slot on the way out, exception or not."""

    def __init__(self, name: str, wait_seconds: float = DEFAULT_WAIT_SECONDS):
        self.name = name
        self.wait_seconds = wait_seconds

    async def __aenter__(self):
        await GPU.acquire(self.name, self.wait_seconds)
        return self

    async def __aexit__(self, exc_type, exc, tb):
        elapsed = GPU._elapsed()
        if elapsed > STUCK_JOB_WARN_SECONDS:
            logger.warning("GPU job '%s' held the slot for %.0fs -- unusually long", self.name, elapsed)
        GPU.release()
        return False  # never swallow exceptions


async def ollama_unload_others(ollama_url: str, keep_model: str | None = None):
    """Ask Ollama to evict every currently-loaded model except
    keep_model (pass None to evict everything). Frees VRAM before a big
    backend job -- e.g. before a ComfyUI generation, or before running
    a vision model -- instead of letting two big models fight over the
    same 6GB card. Best-effort: never raises, since this is a speed/
    reliability optimization, not something correctness depends on."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(f"{ollama_url}/api/ps")
            res.raise_for_status()
            loaded = res.json().get("models", [])
            for m in loaded:
                name = m.get("name") or m.get("model")
                if not name or name == keep_model:
                    continue
                logger.info("Unloading Ollama model %s to free VRAM", name)
                await client.post(f"{ollama_url}/api/generate", json={"model": name, "keep_alive": 0})
    except Exception as e:
        logger.warning("ollama_unload_others: best-effort unload failed (continuing anyway): %s", e)
