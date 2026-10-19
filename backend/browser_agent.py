"""
Browser agent planning loop -- Phase browser-3.

plan_next_action() asks a local Ollama model, JSON-only output, to
pick exactly one action from browser_controller.ACTION_WHITELIST given
the task and the current page state. run_task() drives the
plan -> act -> observe loop until the model reports the goal is done
or MAX_STEPS is hit, then returns a plain-text summary. No screenshots,
no vision model -- planning reads the aria-snapshot text state only,
same reasoning as vision.py's own note about keeping this off the
shared GPU semaphore whenever possible.
"""
import json
import logging

import httpx

import browser_controller as bc
from gpu_manager import ollama_unload_others

logger = logging.getLogger("browser_agent")

OLLAMA_URL = "http://localhost:11434"
PLANNER_MODEL = "qwen3:4b"
MAX_STEPS = 6

SYSTEM_PROMPT = (
    "You control a web browser through a fixed set of actions: "
    "navigate, click, type, scroll, extract_text. "
    "To search, navigate directly to a search results URL such as "
    "https://www.google.com/search?q=YOUR_QUERY -- do not click search "
    "buttons, sign-in links, or cookie/consent dialogs unless the task "
    "specifically requires being signed in. "
    "If your last action did not change the page state, do NOT repeat "
    "the same action again -- pick a different one. "
    "Given the user's task and the current page state (URL, title, "
    "accessibility tree), reply with ONLY a JSON object, no other text: "
    '{"done": false, "action": "click", "target": "text=Sign in", "value": null, "reason": "..."} '
    'or, once the task is complete: {"done": true, "summary": "..."}. '
    "target must be a Playwright selector (e.g. \"text=Learn more\", \"#search-input\"). "
    "Take one small step at a time. ONLY use a click/type target that appears verbatim in the accessibility_tree text below -- if the exact text of the element you want is not present in accessibility_tree, use extract_text or scroll instead, never guess a selector."
)


async def _plan_next_action(task: str, state: dict, history: list[dict]) -> dict:
    user_content = (
        f"Task: {task}\n\n"
        f"Current state: {json.dumps(state)}\n\n"
        f"Steps taken so far: {json.dumps(history)}"
    )
    async with httpx.AsyncClient(timeout=180) as client:
        res = await client.post(
            f"{OLLAMA_URL}/api/chat",
            json={
                "model": PLANNER_MODEL,
                "stream": False,
                "format": "json",
                "think": False,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_content},
                ],
            },
        )
        res.raise_for_status()
        raw = res.json()["message"]["content"]
    import re
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    candidate = match.group(0) if match else raw
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        logger.warning("Planner returned non-JSON, stopping task: %s", raw[:200])
        return {"done": True, "summary": "Stopped: planner returned an unparseable response."}


async def run_task(task: str) -> dict:
    session_id = await bc.start_session()
    await ollama_unload_others(OLLAMA_URL, keep_model=PLANNER_MODEL)
    history: list[dict] = []
    try:
        import os, urllib.parse
        searxng_url = os.environ.get("SEARXNG_URL", "http://localhost:8888")
        search_url = f"{searxng_url}/search?q={urllib.parse.quote(task)}"
        await bc.act(session_id, "navigate", search_url, None)
        history.append({"step": 0, "action": "navigate", "target": search_url, "ok": True})

        for step in range(1, MAX_STEPS):
            state = await bc.read_state(session_id)
            print(f"STEP {step} STATE: {json.dumps(state)[:800]}", flush=True)
            try:
                plan = await _plan_next_action(task, state, history)
            except Exception as e:
                logger.warning("Planner call failed: %s", e)
                return {"session_id": session_id, "steps": history, "summary": f"Stopped: planner error - {e}"}

            if plan.get("done"):
                return {"session_id": session_id, "steps": history, "summary": plan.get("summary", "Done.")}

            logger.info("step %d: planning...", step)

            recent = [h.get("action") for h in history[-2:]] + [plan.get("action")]
            recent_targets = [h.get("target") for h in history[-2:]] + [plan.get("target")]
            if len(history) >= 2 and len(set(recent)) == 1 and len(set(recent_targets)) == 1:
                return {"session_id": session_id, "steps": history, "summary": "Stopped: the same action repeated 3 times with no progress."}

            recent = [h.get("action") for h in history[-2:]] + [plan.get("action")]
            recent_targets = [h.get("target") for h in history[-2:]] + [plan.get("target")]
            if len(history) >= 2 and len(set(recent)) == 1 and len(set(recent_targets)) == 1:
                return {"session_id": session_id, "steps": history, "summary": "Stopped: the same action repeated 3 times with no progress."}
            action = plan.get("action")
            target = plan.get("target")
            value = plan.get("value")

            if action not in ("navigate", "click", "type", "scroll", "extract_text"):
                history.append({"step": step, "action": action, "target": target, "ok": False, "error": "planner returned invalid action"})
                return {"session_id": session_id, "steps": history, "summary": f"Stopped: planner returned an invalid action ({action!r})."}

            try:
                logger.info("step %d: %s -> %s", step, action, target)
                result = await bc.act(session_id, action, target, value)
                history.append({"step": step, "action": action, "target": target, "ok": True})
            except Exception as e:
                history.append({"step": step, "action": action, "target": target, "ok": False, "error": str(e)})

        return {"session_id": session_id, "steps": history, "summary": f"Stopped after {MAX_STEPS} steps without completion."}
    finally:
        await bc.close_session(session_id)
