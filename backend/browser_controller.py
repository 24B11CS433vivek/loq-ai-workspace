"""
Browser automation controller -- Phase browser-1.

Thin wrapper around a single persistent Playwright browser context per
session. Mirrors routers/code.py's sandboxing philosophy: a fixed
whitelist of actions, no arbitrary code execution, hard timeout per
action. State is read as an accessibility-tree snapshot (fast, no GPU)
rather than a screenshot -- screenshots/vision are a deliberate later
fallback, not the default path, to keep this fast on the same shared
GPU used by routers/vision.py and routers/image.py.
"""
import asyncio
import time
import uuid

from fastapi import HTTPException
from playwright.async_api import async_playwright

ACTION_WHITELIST = {"navigate", "click", "type", "scroll", "extract_text"}
ACTION_TIMEOUT_SECONDS = 15
SESSION_IDLE_TIMEOUT_SECONDS = 600

_sessions: dict[str, dict] = {}


def _get_session(session_id: str) -> dict:
    session = _sessions.get(session_id)
    if not session:
        raise HTTPException(404, f"No browser session '{session_id}'. Call /tools/browser/start first.")
    session["last_used"] = time.monotonic()
    return session


async def start_session() -> str:
    session_id = uuid.uuid4().hex[:12]
    playwright = await async_playwright().start()
    browser = await playwright.chromium.launch(headless=True)
    context = await browser.new_context()
    page = await context.new_page()
    _sessions[session_id] = {
        "playwright": playwright,
        "browser": browser,
        "context": context,
        "page": page,
        "last_used": time.monotonic(),
    }
    return session_id


async def act(session_id: str, action: str, target: str | None = None, value: str | None = None) -> dict:
    if action not in ACTION_WHITELIST:
        raise HTTPException(400, f"Action '{action}' not allowed. Allowed: {sorted(ACTION_WHITELIST)}")
    session = _get_session(session_id)
    page = session["page"]

    async def _run():
        if action == "navigate":
            await page.goto(target, wait_until="domcontentloaded")
        elif action == "click":
            await page.click(target)
        elif action == "type":
            await page.fill(target, value or "")
        elif action == "scroll":
            await page.mouse.wheel(0, int(value) if value else 800)
        elif action == "extract_text":
            return {"text": await page.inner_text(target)}
        return {}

    try:
        result = await asyncio.wait_for(_run(), timeout=ACTION_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        raise HTTPException(408, f"Action '{action}' timed out after {ACTION_TIMEOUT_SECONDS}s")
    return {"action": action, "target": target, "result": result}


async def read_state(session_id: str) -> dict:
    session = _get_session(session_id)
    page = session["page"]
    snapshot = await page.locator("body").aria_snapshot()
    return {"url": page.url, "title": await page.title(), "accessibility_tree": snapshot}


async def close_session(session_id: str):
    session = _sessions.pop(session_id, None)
    if not session:
        raise HTTPException(404, f"No browser session '{session_id}'.")
    await session["context"].close()
    await session["browser"].close()
    await session["playwright"].stop()
