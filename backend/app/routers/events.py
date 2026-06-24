from datetime import datetime
from typing import Any, Optional

import asyncpg
from fastapi import APIRouter, Depends, Query

from app.auth import get_current_user
from app.dependencies import get_pool
from app.models import EventResponse

router = APIRouter(prefix="/events", tags=["events"])


@router.get("", response_model=list[EventResponse])
async def list_events(
    type: Optional[str] = Query(None, description="Filter by event type (e.g. task_created)"),
    limit: int = Query(100, ge=1, le=500, description="Number of events to return (max 500)"),
    since: Optional[str] = Query(None, description="ISO timestamp — return only events after this time"),
    pool: asyncpg.Pool = Depends(get_pool),
    _user: dict = Depends(get_current_user),
):
    conditions: list[str] = []
    params: list[Any] = []

    if type:
        params.append(type)
        conditions.append(f"type = ${len(params)}")

    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
            params.append(since_dt)
            conditions.append(f"timestamp > ${len(params)}")
        except ValueError:
            pass  # invalid timestamp — ignore filter

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    params.append(limit)
    query = (
        f"SELECT id, type, payload, timestamp FROM events "
        f"{where} ORDER BY timestamp DESC LIMIT ${len(params)}"
    )

    async with pool.acquire() as conn:
        rows = await conn.fetch(query, *params)

    return [dict(r) for r in rows]


@router.get("/heatmap", response_model=dict[str, int])
async def events_heatmap(
    limit: int = Query(500, ge=1, le=5000, description="Number of recent zone_entry events to aggregate"),
    pool: asyncpg.Pool = Depends(get_pool),
    _user: dict = Depends(get_current_user),
):
    """Return per-zone visit counts aggregated server-side from the most recent zone_entry events."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT payload->>'zone' AS zone, COUNT(*)::int AS count "
            "FROM (SELECT payload FROM events WHERE type='zone_entry' ORDER BY id DESC LIMIT $1) t "
            "GROUP BY zone",
            limit,
        )
    return {r["zone"]: r["count"] for r in rows if r["zone"]}
