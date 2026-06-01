import asyncpg
from fastapi import APIRouter, Depends, Query
from typing import Optional
from app.dependencies import get_pool
from app.models import EventResponse

router = APIRouter(prefix="/events", tags=["events"])


@router.get("", response_model=list[EventResponse])
async def list_events(
    type: Optional[str] = Query(None, description="Filter by event type (e.g. forklift_status_change)"),
    limit: int = Query(100, ge=1, le=500, description="Number of events to return (max 500)"),
    pool: asyncpg.Pool = Depends(get_pool),
):
    if type:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT id, type, payload, timestamp "
                "FROM events WHERE type = $1 "
                "ORDER BY timestamp DESC LIMIT $2",
                type,
                limit,
            )
    else:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT id, type, payload, timestamp "
                "FROM events ORDER BY timestamp DESC LIMIT $1",
                limit,
            )
    return [dict(r) for r in rows]
