from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends
import asyncpg

from app.auth import get_current_user
from app.dependencies import get_pool

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/summary")
async def get_summary(
    pool: asyncpg.Pool = Depends(get_pool),
    _user: dict = Depends(get_current_user),
):
    async with pool.acquire() as conn:
        tasks_per_hour = await conn.fetchval(
            "SELECT COUNT(*)::int FROM tasks "
            "WHERE status='completed' AND updated_at >= NOW() - INTERVAL '1 hour'"
        )
        total_forklifts = await conn.fetchval(
            "SELECT COUNT(*)::int FROM forklifts"
        )
        active_forklifts = await conn.fetchval(
            "SELECT COUNT(*)::int FROM forklifts "
            "WHERE status NOT IN ('idle', 'error')"
        )
        open_alerts = await conn.fetchval(
            "SELECT COUNT(*)::int FROM alerts WHERE resolved=FALSE"
        )
        pending_tasks = await conn.fetchval(
            "SELECT COUNT(*)::int FROM tasks WHERE status='pending'"
        )
        active_tasks = await conn.fetchval(
            "SELECT COUNT(*)::int FROM tasks WHERE status='in-progress'"
        )

    fleet_utilization_pct = round(
        (active_forklifts / total_forklifts * 100) if total_forklifts else 0, 1
    )

    return {
        "tasks_per_hour": tasks_per_hour or 0,
        "fleet_utilization_pct": fleet_utilization_pct,
        "open_alerts": open_alerts or 0,
        "pending_tasks": pending_tasks or 0,
        "active_tasks": active_tasks or 0,
    }


@router.get("/throughput")
async def get_throughput(
    pool: asyncpg.Pool = Depends(get_pool),
    _user: dict = Depends(get_current_user),
):
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT date_trunc('hour', updated_at) AS bucket, COUNT(*)::int AS count "
            "FROM tasks "
            "WHERE status='completed' AND updated_at >= NOW() - INTERVAL '24 hours' "
            "GROUP BY bucket ORDER BY bucket"
        )

    # Normalize DB rows into a UTC-keyed dict.
    db_counts: dict[datetime, int] = {}
    for r in rows:
        bucket_dt = r["bucket"]
        if bucket_dt.tzinfo is None:
            bucket_dt = bucket_dt.replace(tzinfo=timezone.utc)
        bucket_dt = bucket_dt.astimezone(timezone.utc).replace(
            minute=0, second=0, microsecond=0
        )
        db_counts[bucket_dt] = r["count"]

    # Return exactly 24 hourly slots, oldest → newest, filling gaps with 0.
    now_utc = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    return [
        {"bucket": (now_utc - timedelta(hours=23 - i)).isoformat(), "count": db_counts.get(now_utc - timedelta(hours=23 - i), 0)}
        for i in range(24)
    ]


@router.get("/forklift-tasks")
async def get_forklift_tasks(
    pool: asyncpg.Pool = Depends(get_pool),
    _user: dict = Depends(get_current_user),
):
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT t.forklift_id, f.name, COUNT(*)::int AS tasks_completed "
            "FROM tasks t "
            "JOIN forklifts f ON f.id = t.forklift_id "
            "WHERE t.status = 'completed' "
            "  AND t.updated_at >= NOW() - INTERVAL '24 hours' "
            "  AND t.forklift_id IS NOT NULL "
            "GROUP BY t.forklift_id, f.name "
            "ORDER BY tasks_completed DESC"
        )
    return [
        {
            "forklift_id": r["forklift_id"],
            "name": r["name"],
            "tasks_completed": r["tasks_completed"],
        }
        for r in rows
    ]
