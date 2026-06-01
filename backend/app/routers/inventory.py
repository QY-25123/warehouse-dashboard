import asyncpg
from fastapi import APIRouter, Depends, Query
from typing import Optional
from app.dependencies import get_pool
from app.models import InventoryResponse

router = APIRouter(prefix="/inventory", tags=["inventory"])


@router.get("", response_model=list[InventoryResponse])
async def list_inventory(
    zone: Optional[str] = Query(None, description="Filter by location zone (e.g. A1, B3)"),
    pool: asyncpg.Pool = Depends(get_pool),
):
    if zone:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT id, item_name, quantity, location_zone, last_updated "
                "FROM inventory WHERE location_zone = $1 ORDER BY location_zone, id",
                zone.upper(),
            )
    else:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT id, item_name, quantity, location_zone, last_updated "
                "FROM inventory ORDER BY location_zone, id"
            )
    return [dict(r) for r in rows]
