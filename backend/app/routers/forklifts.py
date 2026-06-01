import asyncpg
from fastapi import APIRouter, Depends
from app.dependencies import get_pool
from app.models import ForkliftResponse

router = APIRouter(prefix="/forklifts", tags=["forklifts"])


@router.get("", response_model=list[ForkliftResponse])
async def list_forklifts(pool: asyncpg.Pool = Depends(get_pool)):
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, name, status::text, x, y, last_updated "
            "FROM forklifts ORDER BY id"
        )
    return [dict(r) for r in rows]
