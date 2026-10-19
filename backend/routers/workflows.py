from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import workflows as wf_store

router = APIRouter(prefix="/tools/workflows", tags=["workflows"])


class WorkflowCreate(BaseModel):
    name: str
    model: str
    system_prompt: str = ""
    enabled_tools: list[str] = []


class WorkflowUpdate(BaseModel):
    name: str | None = None
    model: str | None = None
    system_prompt: str | None = None
    enabled_tools: list[str] | None = None


@router.get("")
async def list_workflows():
    return wf_store.list_workflows()


@router.post("")
async def create_workflow(body: WorkflowCreate):
    return wf_store.create_workflow(body.name, body.model, body.system_prompt, body.enabled_tools)


@router.put("/{workflow_id}")
async def update_workflow(workflow_id: str, body: WorkflowUpdate):
    result = wf_store.update_workflow(workflow_id, **body.model_dump())
    if result is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return result


@router.delete("/{workflow_id}")
async def delete_workflow(workflow_id: str):
    ok = wf_store.delete_workflow(workflow_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return {"deleted": True}
