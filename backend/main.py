import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from routers import browser, code, convert, data, documents, image, rag, search, svg, system, universal_generate, vision, voice, workflows
from searxng_manager import ensure_searxng_running

logger = logging.getLogger("loq.main")


def _warm_enhance_models():
    """Load gfpgan/realesrgan/rembg once at startup (this is where any
    first-time weight download happens too) so the very first real
    /tools/image/enhance request doesn't eat that cold-start cost out
    of its own request timeout. Never raises -- if a model fails to
    warm (no network, disk issue, etc.) it just falls back to lazy-
    loading on first use like before; startup still succeeds either
    way."""
    device = image._pick_device()
    for name, getter, arg in (
        ("GFPGAN", image._get_gfpgan, device),
        ("Real-ESRGAN", image._get_realesrgan, device),
        ("rembg", image._get_rembg_session, device),
    ):
        try:
            getter(arg)
            logger.info("Warmed %s on %s", name, device)
        except Exception:
            logger.warning("%s warmup failed -- will lazy-load on first /enhance request instead", name, exc_info=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start (or restart) SearXNG automatically the moment the backend
    # boots, so you never have to separately remember `docker start
    # searxng` / `docker compose up -d` before using web search.
    started = await ensure_searxng_running(search.SEARXNG_URL)
    if not started:
        print(
            f"[startup] WARNING: could not bring up SearXNG at {search.SEARXNG_URL}. "
            "Web search will fail until it's started manually "
            "(check `docker ps -a`, SEARXNG_CONTAINER_NAME, SEARXNG_COMPOSE_DIR env vars)."
        )

    # Blocking (awaited) on purpose: pay the one-time model
    # download/load cost here, during startup, instead of inside a
    # user's first enhance request. Adds to how long `systemctl
    # restart` takes to report ready -- that's the trade we want.
    await asyncio.to_thread(_warm_enhance_models)

    yield


app = FastAPI(title="LOQ AI Workspace Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    # Vite falls back to 5174/5175/... if 5173 is busy — match any
    # localhost/127.0.0.1 dev port instead of hardcoding one, so a
    # stray "port already in use" doesn't silently break every fetch
    # from the frontend via CORS.
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(documents.router)
app.include_router(convert.router)
app.include_router(rag.router)
app.include_router(search.router)
app.include_router(data.router)
app.include_router(universal_generate.router)
app.include_router(image.router)
app.include_router(vision.router)
app.include_router(voice.router)
app.include_router(system.router)
app.include_router(code.router)
app.include_router(svg.router)
app.include_router(browser.router)
app.include_router(workflows.router)

# Phase 8 — serve generated .pptx/.docx/.pdf files back to the browser
# as plain downloadable static files.
app.mount("/files", StaticFiles(directory=str(universal_generate.GENERATED_DIR)), name="files")


# Crash-proofing: any exception not already handled by a route (a bug,
# an OOM'd model, a corrupt upload, whatever) lands here instead of
# killing the uvicorn worker -- the client gets a normal 500 JSON
# response and the backend keeps serving the next request.
@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error. The backend stayed up -- check server logs for details."},
    )


@app.get("/health")
def health():
    return {"status": "ok"}
