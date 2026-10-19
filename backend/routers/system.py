"""
System / diagnostics -- Phase 11.

Read-only visibility into the shared GPU slot (gpu_manager.GPU) and
Ollama's currently loaded models, plus a manual reset for the rare
case a stuck slot needs clearing without a full uvicorn restart.
"""
import httpx
from fastapi import APIRouter, HTTPException

from gpu_manager import GPU

router = APIRouter(prefix="/system", tags=["system"])

OLLAMA_URL = "http://localhost:11434"


@router.get("/gpu-status")
async def gpu_status():
    """What the shared GPU slot is doing right now, if anything."""
    return {"gpu_slot": GPU.status()}


@router.get("/ollama-models")
async def ollama_models():
    """Passthrough to Ollama's own /api/ps -- same data `ollama ps` shows,
    including the CPU/GPU processor split for each loaded model."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(f"{OLLAMA_URL}/api/ps")
            res.raise_for_status()
            return res.json()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Could not reach Ollama at {OLLAMA_URL}: {e}")


@router.post("/gpu-reset")
async def gpu_reset():
    """Force-clears the shared GPU slot. Nothing in this codebase should
    be able to leave it stuck (gpu_job always releases in __aexit__),
    but this exists as a last-resort escape hatch instead of requiring
    a uvicorn restart if a future bug ever manages to anyway."""
    previous = GPU.force_release()
    return {"reset": True, "was": previous}
