import asyncpg
from fastapi import APIRouter, Depends, Query
from typing import Optional
from app.auth import get_current_user
from app.dependencies import get_pool
from app.models import TaskResponse

router = APIRouter(prefix="/tasks", tags=["tasks"])

VALID_STATUSES = {"pending", "in-progress", "completed", "delayed", "out_of_stock"}
VALID_TYPES    = {"inbound", "outbound", "relocation", "replenishment"}


@router.get("", response_model=list[TaskResponse])
async def list_tasks(
    status: Optional[str] = Query(None, description="Filter by status"),
    type:   Optional[str] = Query(None, description="Filter by task type"),
    pool:   asyncpg.Pool  = Depends(get_pool),
    _user:  dict           = Depends(get_current_user),
):
    conditions: list[str] = []
    params: list[str] = []

    if status:
        if status not in VALID_STATUSES:
            from fastapi import HTTPException
            raise HTTPException(
                status_code=422,
                detail=f"Invalid status. Must be one of: {sorted(VALID_STATUSES)}",
            )
        params.append(status)
        conditions.append(f"t.status = ${len(params)}::task_status")

    if type:
        if type not in VALID_TYPES:
            from fastapi import HTTPException
            raise HTTPException(
                status_code=422,
                detail=f"Invalid type. Must be one of: {sorted(VALID_TYPES)}",
            )
        params.append(type)
        conditions.append(f"t.type = ${len(params)}::task_type")

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    query = (
        f"SELECT t.id, t.type::text, t.forklift_id, t.status::text, "
        f"       t.origin_zone, t.destination_zone, "
        f"       t.inventory_item_id, i.item_name, "
        f"       t.created_at, t.updated_at "
        f"FROM tasks t "
        f"LEFT JOIN inventory i ON i.id = t.inventory_item_id "
        f"{where} ORDER BY t.created_at DESC"
    )

    async with pool.acquire() as conn:
        rows = await conn.fetch(query, *params)
    return [dict(r) for r in rows]
