import json
import os
import uuid

WORKFLOWS_PATH = os.path.join(os.path.dirname(__file__), "workflows.json")


def _load() -> list[dict]:
    if not os.path.exists(WORKFLOWS_PATH):
        return []
    with open(WORKFLOWS_PATH, "r") as f:
        return json.load(f)


def _save(workflows: list[dict]):
    with open(WORKFLOWS_PATH, "w") as f:
        json.dump(workflows, f, indent=2)


def list_workflows() -> list[dict]:
    return _load()


def create_workflow(name: str, model: str, system_prompt: str, enabled_tools: list[str]) -> dict:
    workflows = _load()
    wf = {
        "id": uuid.uuid4().hex[:12],
        "name": name,
        "model": model,
        "system_prompt": system_prompt,
        "enabled_tools": enabled_tools,
    }
    workflows.append(wf)
    _save(workflows)
    return wf


def update_workflow(workflow_id: str, **fields) -> dict | None:
    workflows = _load()
    for wf in workflows:
        if wf["id"] == workflow_id:
            wf.update({k: v for k, v in fields.items() if v is not None})
            _save(workflows)
            return wf
    return None


def delete_workflow(workflow_id: str) -> bool:
    workflows = _load()
    new_workflows = [w for w in workflows if w["id"] != workflow_id]
    if len(new_workflows) == len(workflows):
        return False
    _save(new_workflows)
    return True
