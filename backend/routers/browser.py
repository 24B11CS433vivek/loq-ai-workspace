"""
Browser automation router -- Phase browser-2.

Thin HTTP wrapper around browser_controller.py's session-based
Playwright controller. Modeled on routers/code.py's sandboxing style:
a fixed action whitelist (enforced in browser_controller.py), one
Playwright context per session, hard timeout per action (also
enforced in browser_controller.py). This router does no browser work
itself -- it only validates input and delegates.
"""
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import browser_controller as bc
import browser_agent

router = APIRouter(prefix="/tools/browser", tags=["browser"])

_SESSION_ID_RE = re.compile(r"^[a-f0-9]{12}$")


def _validate_session_id(session_id: str) -> str:
    if not _SESSION_ID_RE.match(session_id or ""):
        raise HTTPException(400, "Invalid session id.")
    return session_id


class ActBody(BaseModel):
    session_id: str
    action: str
    target: str | None = None
    value: str | None = None


@router.post("/start")
async def browser_start():
    session_id = await bc.start_session()
    return {"session_id": session_id}


@router.post("/act")
async def browser_act(body: ActBody):
    _validate_session_id(body.session_id)
    return await bc.act(body.session_id, body.action, body.target, body.value)


@router.get("/state")
async def browser_state(session_id: str):
    _validate_session_id(session_id)
    return await bc.read_state(session_id)


@router.post("/close")
async def browser_close(session_id: str):
    _validate_session_id(session_id)
    await bc.close_session(session_id)
    return {"session_id": session_id, "closed": True}


class TaskBody(BaseModel):
    task: str


@router.post("/task")
async def browser_task(body: TaskBody):
    if not body.task or not body.task.strip():
        raise HTTPException(400, "task must not be empty.")
    return await browser_agent.run_task(body.task.strip())
