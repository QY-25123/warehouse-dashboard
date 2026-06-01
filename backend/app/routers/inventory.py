import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from app.dependencies import get_pool
from app.models import InventoryResponse, InventoryTaskResponse, EventResponse

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


@router.get("/{item_id}", response_model=InventoryResponse)
async def get_inventory_item(
    item_id: int,
    pool: asyncpg.Pool = Depends(get_pool),
):
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, item_name, quantity, location_zone, last_updated "
            "FROM inventory WHERE id = $1",
            item_id,
        )
    if row is None:
        raise HTTPException(status_code=404, detail=f"Inventory item {item_id} not found")
    return dict(row)


@router.get("/{item_id}/tasks", response_model=list[InventoryTaskResponse])
async def get_item_tasks(
    item_id: int,
    pool: asyncpg.Pool = Depends(get_pool),
):
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT t.id, t.type::text, t.forklift_id, f.name AS forklift_name, "
            "       t.status::text, t.origin_zone, t.destination_zone, "
            "       t.inventory_item_id, i.item_name, t.created_at, t.updated_at "
            "FROM tasks t "
            "LEFT JOIN forklifts f ON f.id = t.forklift_id "
            "LEFT JOIN inventory i ON i.id = t.inventory_item_id "
            "WHERE t.inventory_item_id = $1 "
            "ORDER BY t.created_at DESC LIMIT 30",
            item_id,
        )
    return [dict(r) for r in rows]


@router.get("/{item_id}/history", response_model=list[EventResponse])
async def get_item_history(
    item_id: int,
    pool: asyncpg.Pool = Depends(get_pool),
):
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, type, payload, timestamp FROM events "
            "WHERE type IN ('inventory_restocked', 'inventory_depleted', 'inventory_relocated') "
            "  AND (payload->>'item_id')::int = $1 "
            "ORDER BY timestamp DESC LIMIT 50",
            item_id,
        )
    return [dict(r) for r in rows]
