"""Keeps the SearXNG dependency alive without manual `docker start`/
`docker compose up` babysitting.

Two things call into this module:
  1. main.py's startup hook -- makes sure SearXNG is up the moment the
     backend itself starts, so you never have to remember to start it
     separately.
  2. search.py's request-time retry -- if SearXNG has crashed or been
     OOM-killed mid-session (the actual cause of the random "Web search
     failed" toast / 502s you were seeing), one search request tries to
     nudge it back up and retries once before giving up.

Configurable via env vars so this isn't hardcoded to one machine's paths:
  SEARXNG_CONTAINER_NAME (default: "searxng")
  SEARXNG_COMPOSE_DIR    (default: "~/searxng")
"""
import asyncio
import os
import subprocess

import httpx

SEARXNG_CONTAINER_NAME = os.environ.get("SEARXNG_CONTAINER_NAME", "searxng")
SEARXNG_COMPOSE_DIR = os.environ.get(
    "SEARXNG_COMPOSE_DIR", os.path.expanduser("~/searxng")
)


async def is_searxng_up(url: str, timeout: float = 5.0) -> bool:
    """Liveness check ONLY -- deliberately does NOT hit /search. A real
    search has to wait on every configured upstream engine (DuckDuckGo,
    Wikidata, etc.) before SearXNG can respond, which can legitimately
    take 15-20+ seconds when those engines are CAPTCHA'd/rate-limited/
    slow -- that's a slow-but-healthy server, not a dead one. Hitting
    /search here caused false "not reachable" verdicts (and pointless
    docker restarts) on a container that was actually fine. /config is
    served directly by SearXNG itself with no upstream engine calls, so
    it answers almost instantly if and only if the process is actually up.
    """
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.get(f"{url}/config")
            return res.status_code < 500
    except Exception:
        return False


def _try_start_searxng_container() -> bool:
    """Best-effort: `docker start` the named container first (fast path
    for the common case -- it exists but stopped/crashed). If that fails
    (e.g. container was never created here), fall back to
    `docker compose up -d` in SEARXNG_COMPOSE_DIR. Returns True only if
    a start command actually reported success -- caller still needs to
    poll is_searxng_up() afterward since "docker start" returning 0
    doesn't mean the service inside is healthy yet.
    """
    try:
        result = subprocess.run(
            ["docker", "start", SEARXNG_CONTAINER_NAME],
            capture_output=True, text=True, timeout=15,
        )
        if result.returncode == 0:
            print(f"[searxng-manager] docker start {SEARXNG_CONTAINER_NAME}: OK")
            return True
        print(f"[searxng-manager] docker start {SEARXNG_CONTAINER_NAME} failed: {result.stderr.strip()}")
    except FileNotFoundError:
        print("[searxng-manager] docker CLI not found -- is Docker installed and on PATH?")
        return False
    except Exception as e:
        print(f"[searxng-manager] docker start raised: {e}")

    try:
        result = subprocess.run(
            ["docker", "compose", "up", "-d"],
            cwd=SEARXNG_COMPOSE_DIR,
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            print(f"[searxng-manager] docker compose up -d in {SEARXNG_COMPOSE_DIR}: OK")
            return True
        print(f"[searxng-manager] docker compose up -d in {SEARXNG_COMPOSE_DIR} failed: {result.stderr.strip()}")
    except Exception as e:
        print(f"[searxng-manager] docker compose up -d raised: {e}")
    return False


async def ensure_searxng_running(url: str, max_wait_seconds: int = 20) -> bool:
    """Returns True once SearXNG answers, starting/restarting it first
    if needed. Never raises -- callers decide what to do if this still
    comes back False (e.g. surface the existing 502 to the user).
    """
    if await is_searxng_up(url):
        return True
    print("[searxng-manager] SearXNG not reachable -- attempting to start it")
    if not _try_start_searxng_container():
        return False
    waited = 0
    while waited < max_wait_seconds:
        await asyncio.sleep(2)
        waited += 2
        if await is_searxng_up(url):
            print(f"[searxng-manager] SearXNG came up after {waited}s")
            return True
    print(f"[searxng-manager] SearXNG still not reachable after {max_wait_seconds}s")
    return False
