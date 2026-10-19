"""
Coding Agent sandbox -- Phase 12.

Three endpoints, all confined to backend/data/code_projects/<project>/:
  GET  /tools/code/tree   -- list files in a project
  POST /tools/code/write  -- write/create a file inside the project
  POST /tools/code/run    -- run a .py or .js file inside the project,
                              capturing stdout/stderr with a hard timeout

No new dependencies -- run() uses stdlib subprocess only. All model
calls that need a coding-specific LLM (not exposed here yet, wired in
from the frontend side in 12B) must use qwen2.5-coder:7b regardless of
the session's chosen chat model -- see CODER_MODEL below.
"""
import asyncio
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/tools/code", tags=["code"])

CODER_MODEL = "qwen2.5-coder:7b"

CODE_ROOT = Path(__file__).resolve().parent.parent / "data" / "code_projects"
CODE_ROOT.mkdir(parents=True, exist_ok=True)

_PROJECT_NAME_RE = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")

_RUNNERS = {
    ".py": ["python3", "-u"],
    ".js": ["node"],
}

RUN_TIMEOUT_SECONDS = 15


def _project_dir(project: str) -> Path:
    if not _PROJECT_NAME_RE.match(project or ""):
        raise HTTPException(400, "Invalid project name (use letters, numbers, _ or -, max 64 chars).")
    d = (CODE_ROOT / project).resolve()
    if CODE_ROOT.resolve() not in d.parents and d != CODE_ROOT.resolve():
        raise HTTPException(400, "Invalid project path.")
    d.mkdir(parents=True, exist_ok=True)
    return d


def _safe_join(project_dir: Path, rel_path: str) -> Path:
    if not rel_path or rel_path.startswith("/") or rel_path.startswith("\\"):
        raise HTTPException(400, "Path must be relative to the project.")
    candidate = (project_dir / rel_path).resolve()
    if project_dir.resolve() != candidate and project_dir.resolve() not in candidate.parents:
        raise HTTPException(400, f"Path '{rel_path}' escapes the project sandbox.")
    return candidate


class WriteFileBody(BaseModel):
    project: str = "default"
    path: str
    content: str


class RunBody(BaseModel):
    project: str = "default"
    entrypoint: str
    args: list[str] = []


@router.get("/tree")
async def code_tree(project: str = "default"):
    project_dir = _project_dir(project)
    files = []
    for p in sorted(project_dir.rglob("*")):
        if p.is_file():
            rel = p.relative_to(project_dir).as_posix()
            files.append({"path": rel, "size": p.stat().st_size})
    return {"project": project, "root": str(project_dir), "files": files}


@router.post("/write")
async def code_write(body: WriteFileBody):
    project_dir = _project_dir(body.project)
    target = _safe_join(project_dir, body.path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(body.content, encoding="utf-8")
    return {
        "project": body.project,
        "path": body.path,
        "bytes_written": len(body.content.encode("utf-8")),
    }


@router.get("/read")
async def code_read(project: str, path: str):
    project_dir = _project_dir(project)
    target = _safe_join(project_dir, path)
    if not target.is_file():
        raise HTTPException(404, f"No such file: {path}")
    return {"project": project, "path": path, "content": target.read_text(encoding="utf-8")}


@router.post("/run")
async def code_run(body: RunBody):
    project_dir = _project_dir(body.project)
    entry = _safe_join(project_dir, body.entrypoint)
    if not entry.is_file():
        raise HTTPException(404, f"No such file: {body.entrypoint}")

    ext = entry.suffix.lower()
    runner = _RUNNERS.get(ext)
    if not runner:
        raise HTTPException(400, f"Unsupported entrypoint type '{ext}'. Allowed: {list(_RUNNERS)}")

    cmd = [*runner, str(entry), *body.args]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=str(project_dir),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as e:
        raise HTTPException(500, f"Interpreter not found on this machine: {e}")

    timed_out = False
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=RUN_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        timed_out = True
        proc.kill()
        stdout, stderr = await proc.communicate()

    return {
        "project": body.project,
        "entrypoint": body.entrypoint,
        "command": cmd,
        "exit_code": proc.returncode,
        "timed_out": timed_out,
        "stdout": stdout.decode("utf-8", errors="replace"),
        "stderr": stderr.decode("utf-8", errors="replace"),
    }
