import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from app.dependencies import get_pool
from app.models import AlertResponse

router = APIRouter(prefix="/alerts", tags=["alerts"])

VALID_SEVERITIES = {"info", "warning", "critical"}


@router.get("", response_model=list[AlertResponse])
async def list_alerts(
    severity: Optional[str] = Query(None, description="Filter by severity: info, warning, critical"),
    include_resolved: bool = Query(False, description="Include resolved alerts (default: active only)"),
    pool: asyncpg.Pool = Depends(get_pool),
):
    conditions: list[str] = []
    params: list = []

    if not include_resolved:
        conditions.append("resolved = FALSE")

    if severity:
        if severity not in VALID_SEVERITIES:
            from fastapi import HTTPException
            raise HTTPException(status_code=422, detail=f"Invalid severity. Must be one of: {sorted(VALID_SEVERITIES)}")
        params.append(severity)
        conditions.append(f"severity = ${len(params)}::alert_severity")

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    query = (
        f"SELECT id, severity::text, message, resolved, created_at "
        f"FROM alerts {where} ORDER BY created_at DESC"
    )

    async with pool.acquire() as conn:
        rows = await conn.fetch(query, *params)
    return [dict(r) for r in rows]


@router.patch("/{alert_id}", response_model=AlertResponse)
async def resolve_alert(
    alert_id: int,
    pool: asyncpg.Pool = Depends(get_pool),
):
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "UPDATE alerts SET resolved = TRUE "
            "WHERE id = $1 "
            "RETURNING id, severity::text, message, resolved, created_at",
            alert_id,
        )
    if row is None:
        raise HTTPException(status_code=404, detail=f"Alert {alert_id} not found")
    return dict(row)
