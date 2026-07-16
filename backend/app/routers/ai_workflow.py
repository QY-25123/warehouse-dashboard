"""
AI-powered agentic workflow for warehouse task planning.

Claude uses tool_use to interpret natural language, look up inventory and
forklift state, then generate an optimised multi-forklift execution plan.
"""

import json
import math
import os
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import get_current_user, require_admin
from app.dependencies import get_pool
from app.models import AIPlanRequest, AIExecuteRequest, UpdateCapacityRequest

router = APIRouter(prefix="/ai", tags=["ai"])

# Zone centre coordinates — mirrors simulator._ZONE_COORDS
_ZONE_COORDS: dict[str, tuple[float, float]] = {
    'A1': (12.5,   5.0), 'A2': (37.5,   5.0), 'A3': (62.5,   5.0), 'A4': (87.5,   5.0),
    'B1': (12.5,  15.0), 'B2': (37.5,  15.0), 'B3': (62.5,  15.0), 'B4': (87.5,  15.0),
    'C1': (12.5,  25.0), 'C2': (37.5,  25.0), 'C3': (62.5,  25.0), 'C4': (87.5,  25.0),
    'D1': (12.5,  35.0), 'D2': (37.5,  35.0), 'D3': (62.5,  35.0), 'D4': (87.5,  35.0),
    'E1': (12.5,  45.0), 'E2': (37.5,  45.0), 'E3': (62.5,  45.0), 'E4': (87.5,  45.0),
    'F1': (12.5,  55.0), 'F2': (37.5,  55.0), 'F3': (62.5,  55.0), 'F4': (87.5,  55.0),
    'G1': (12.5,  65.0), 'G2': (37.5,  65.0), 'G3': (62.5,  65.0), 'G4': (87.5,  65.0),
    'H1': (12.5,  75.0), 'H2': (37.5,  75.0), 'H3': (62.5,  75.0), 'H4': (87.5,  75.0),
    'I1': (12.5,  85.0), 'I2': (37.5,  85.0), 'I3': (62.5,  85.0), 'I4': (87.5,  85.0),
    'J1': (12.5,  95.0), 'J2': (37.5,  95.0), 'J3': (62.5,  95.0), 'J4': (87.5,  95.0),
    'K1': (12.5, 105.0), 'K2': (37.5, 105.0), 'K3': (62.5, 105.0), 'K4': (87.5, 105.0),
    'DOCK': (-10.0,  55.0),
    'SHIP': (110.0,  55.0),
    'STOR': ( 50.0, 118.0),
}

_SPEED_SVG_PER_TICK: float = 4.0   # SVG units the forklift covers each tick
_TICK_SECONDS: float        = 2.0   # wall-clock seconds per simulator tick
_LOADING_TICKS: int         = 3     # ticks spent loading/unloading per leg


# ── Pure optimisation logic ───────────────────────────────────────────────────

def _euclidean(ax: float, ay: float, bx: float, by: float) -> float:
    return math.sqrt((ax - bx) ** 2 + (ay - by) ** 2)


def _zone_dist(zone_a: str, zone_b: str) -> float:
    ax, ay = _ZONE_COORDS.get(zone_a, (50.0, 50.0))
    bx, by = _ZONE_COORDS.get(zone_b, (50.0, 50.0))
    return _euclidean(ax, ay, bx, by)


def _compute_plan(
    task_type: str,
    item_id: int,
    item_name: str,
    quantity: int,
    available_quantity: int,
    origin_zone: str,
    destination_zone: str,
    forklifts: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    Optimise trip distribution across idle forklifts.

    Strategy: round-robin distribution (sorted closest-first) so all
    available forklifts work in parallel, minimising makespan.
    """
    actual_qty = min(quantity, available_quantity)
    insufficient = actual_qty < quantity

    if actual_qty <= 0:
        return {
            "ok": False,
            "error": f"No stock available for '{item_name}' in zone {origin_zone}.",
            "quantity_available": available_quantity,
        }

    if not forklifts:
        return {
            "ok": False,
            "error": "No idle forklifts are available right now.",
            "quantity_available": available_quantity,
        }

    # Annotate each forklift with its distance to the pickup zone
    ox, oy = _ZONE_COORDS.get(origin_zone, (50.0, 50.0))
    for f in forklifts:
        f['dist_to_origin'] = _euclidean(float(f['x']), float(f['y']), ox, oy)
    forklifts.sort(key=lambda f: f['dist_to_origin'])

    # Travel times
    leg_ticks       = _zone_dist(origin_zone, destination_zone) / _SPEED_SVG_PER_TICK
    # Round-trip: deliver + return to origin + loading at both ends
    round_trip_ticks = 2 * leg_ticks + 2 * _LOADING_TICKS

    # Round-robin trip assignment (closest-first within each round)
    trips_map: dict[int, int] = {f['id']: 0 for f in forklifts}
    units_map: dict[int, int] = {f['id']: 0 for f in forklifts}
    remaining = actual_qty

    while remaining > 0:
        for f in forklifts:
            if remaining <= 0:
                break
            units_this = min(f['capacity'], remaining)
            trips_map[f['id']] += 1
            units_map[f['id']] += units_this
            remaining -= units_this

    # Build per-forklift assignment records
    assignments: list[dict[str, Any]] = []
    for f in forklifts:
        trips = trips_map[f['id']]
        if trips == 0:
            continue
        first_trip_ticks = (
            f['dist_to_origin'] / _SPEED_SVG_PER_TICK   # travel to pickup
            + leg_ticks                                   # deliver to destination
            + 2 * _LOADING_TICKS                         # load + unload
        )
        total_ticks = first_trip_ticks + max(0, trips - 1) * round_trip_ticks
        assignments.append({
            'forklift_id':       f['id'],
            'forklift_name':     f['name'],
            'capacity':          f['capacity'],
            'trips':             trips,
            'units_assigned':    units_map[f['id']],
            'dist_to_origin_svgu': round(f['dist_to_origin'], 1),
            'estimated_ticks':   round(total_ticks),
            'estimated_seconds': round(total_ticks * _TICK_SECONDS),
        })

    assignments.sort(key=lambda a: a['estimated_seconds'])
    makespan_s = max(a['estimated_seconds'] for a in assignments) if assignments else 0

    return {
        "ok": True,
        "task_type":         task_type,
        "item_id":           item_id,
        "item_name":         item_name,
        "quantity_requested": quantity,
        "quantity_planned":  actual_qty,
        "quantity_available": available_quantity,
        "insufficient_stock": insufficient,
        "origin_zone":       origin_zone,
        "destination_zone":  destination_zone,
        "assignments":       assignments,
        "total_trips":       sum(a['trips'] for a in assignments),
        "total_forklifts_used": len(assignments),
        "makespan_s":        makespan_s,
    }


# ── Tool handlers ─────────────────────────────────────────────────────────────

async def _tool_search_inventory(query: str, conn: asyncpg.Connection) -> list[dict]:
    rows = await conn.fetch(
        "SELECT id, item_name, quantity, location_zone "
        "FROM inventory "
        "WHERE item_name ILIKE $1 "
        "ORDER BY quantity DESC LIMIT 10",
        f"%{query}%",
    )
    return [dict(r) for r in rows]


async def _tool_get_forklifts(conn: asyncpg.Connection) -> list[dict]:
    rows = await conn.fetch(
        "SELECT id, name, status::text AS status, x, y, capacity "
        "FROM forklifts WHERE status = 'idle' ORDER BY id"
    )
    return [
        {
            'id': r['id'], 'name': r['name'], 'status': r['status'],
            'x': float(r['x']), 'y': float(r['y']), 'capacity': r['capacity'],
        }
        for r in rows
    ]


# ── Claude agentic loop ───────────────────────────────────────────────────────

_TOOLS = [
    {
        "name": "search_inventory",
        "description": (
            "Search warehouse inventory by item name. "
            "Returns matching items with their quantity, location zone, and item ID."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Item name or partial name to search for (case-insensitive)"
                }
            },
            "required": ["query"]
        }
    },
    {
        "name": "get_available_forklifts",
        "description": "Get all currently idle forklifts with their positions and load capacities (units per trip).",
        "input_schema": {
            "type": "object",
            "properties": {}
        }
    },
    {
        "name": "create_execution_plan",
        "description": (
            "Generate an optimised multi-forklift execution plan. "
            "The planner distributes trips across idle forklifts to minimise total completion time."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "task_type": {
                    "type": "string",
                    "enum": ["inbound", "outbound", "relocation", "replenishment"],
                    "description": "Type of warehouse task"
                },
                "item_id":   {"type": "integer", "description": "Inventory item ID from search_inventory"},
                "item_name": {"type": "string",  "description": "Inventory item name"},
                "quantity":  {"type": "integer", "description": "Number of units to move"},
                "origin_zone": {
                    "type": "string",
                    "description": "Zone where goods are picked up (e.g. 'B2', 'DOCK', 'STOR')"
                },
                "destination_zone": {
                    "type": "string",
                    "description": "Zone where goods are delivered (e.g. 'C3', 'SHIP')"
                }
            },
            "required": ["task_type", "item_id", "item_name", "quantity", "origin_zone", "destination_zone"]
        }
    }
]

_SYSTEM = """\
You are a warehouse operations AI assistant that converts natural language requests into optimised forklift execution plans.

Warehouse layout:
- Storage grid: zones A1–K4 (11 rows × 4 columns)
- Special zones: DOCK (inbound receiving), SHIP (outbound shipping), STOR (bulk replenishment storage)

Task types and their zone rules:
- outbound:      pick up from a warehouse zone → deliver to SHIP
- inbound:       pick up from DOCK → deliver to a warehouse zone
- relocation:    move items from one warehouse zone to another
- replenishment: pick up from STOR → deliver to a low-stock warehouse zone

Your workflow for each user request:
1. Call search_inventory to identify the item and its current zone and stock level
2. Call get_available_forklifts to see what's available
3. Call create_execution_plan with the correct task_type, item_id, quantity, origin_zone, and destination_zone
4. Write a concise 2–3 sentence summary for the operator explaining your interpretation and the plan

Zone rules for common requests:
- "outbound X units of Y"  → task_type=outbound, origin=item's zone, destination=SHIP
- "inbound X units of Y"   → task_type=inbound,  origin=DOCK,        destination=item's zone
- "move Y from Z1 to Z2"   → task_type=relocation if both are grid zones
- "restock Y"              → task_type=replenishment, origin=STOR

If stock is insufficient, acknowledge it and plan for the available quantity.
If the item name is ambiguous, pick the closest match and note your assumption.
Be professional and concise.\
"""


async def _run_agent(message: str, conn: asyncpg.Connection) -> dict[str, Any]:
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ANTHROPIC_API_KEY is not configured on the server.",
        )

    # Import here so the server still starts without the key set
    import anthropic as _anthropic  # noqa: PLC0415

    client = _anthropic.AsyncAnthropic(api_key=api_key)

    messages: list[dict] = [{"role": "user", "content": message}]
    plan: dict[str, Any] | None = None
    explanation = ""
    forklifts_cache: list[dict] | None = None

    for _ in range(12):  # hard cap on tool rounds
        response = await client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=_SYSTEM,
            tools=_TOOLS,
            messages=messages,
        )

        # Capture any text from this turn
        for block in response.content:
            if hasattr(block, "text") and block.text:
                explanation = block.text

        if response.stop_reason == "end_turn":
            break

        if response.stop_reason != "tool_use":
            break

        # Execute requested tools
        tool_results: list[dict] = []
        for block in response.content:
            if block.type != "tool_use":
                continue

            name  = block.name
            inp   = block.input

            if name == "search_inventory":
                result = await _tool_search_inventory(inp["query"], conn)

            elif name == "get_available_forklifts":
                forklifts_cache = await _tool_get_forklifts(conn)
                result = forklifts_cache

            elif name == "create_execution_plan":
                item_row = await conn.fetchrow(
                    "SELECT quantity FROM inventory WHERE id=$1", inp["item_id"],
                )
                # For inbound/replenishment, goods come from external sources (DOCK/STOR)
                # so current stock does not limit how much can be moved.
                if inp["task_type"] in ("inbound", "replenishment"):
                    available_qty = inp["quantity"]
                else:
                    available_qty = int(item_row["quantity"]) if item_row else 0

                if forklifts_cache is None:
                    forklifts_cache = await _tool_get_forklifts(conn)

                plan = _compute_plan(
                    task_type=inp["task_type"],
                    item_id=inp["item_id"],
                    item_name=inp["item_name"],
                    quantity=inp["quantity"],
                    available_quantity=available_qty,
                    origin_zone=inp["origin_zone"],
                    destination_zone=inp["destination_zone"],
                    forklifts=list(forklifts_cache),  # copy — _compute_plan mutates the list
                )
                result = plan

            else:
                result = {"error": f"Unknown tool: {name}"}

            tool_results.append({
                "type":        "tool_result",
                "tool_use_id": block.id,
                "content":     json.dumps(result, default=str),
            })

        messages.append({"role": "assistant", "content": response.content})
        messages.append({"role": "user",      "content": tool_results})

    return {"plan": plan, "explanation": explanation}


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/plan")
async def plan_task(
    body: AIPlanRequest,
    pool: asyncpg.Pool = Depends(get_pool),
    _user: dict = Depends(get_current_user),
):
    """Convert a natural language request into an optimised forklift execution plan."""
    if not body.message.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Message cannot be empty")

    async with pool.acquire() as conn:
        result = await _run_agent(body.message.strip(), conn)

    if result["plan"] is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "explanation": result["explanation"],
                "error": "Claude could not generate an execution plan for this request.",
            },
        )

    return {"plan": result["plan"], "explanation": result["explanation"]}


@router.post("/execute")
async def execute_plan(
    body: AIExecuteRequest,
    pool: asyncpg.Pool = Depends(get_pool),
    _user: dict = Depends(get_current_user),
):
    """Insert pending tasks for each trip in the approved plan."""
    plan = body.plan

    if not plan.get("ok"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, plan.get("error", "Plan is not executable"))

    task_type   = plan["task_type"]
    item_id     = plan["item_id"]
    origin      = plan["origin_zone"]
    destination = plan["destination_zone"]
    assignments = plan.get("assignments", [])

    task_ids: list[int] = []
    async with pool.acquire() as conn:
        async with conn.transaction():
            for assignment in assignments:
                fid            = assignment.get("forklift_id")
                trips          = assignment["trips"]
                capacity       = assignment.get("capacity", 50)
                units_assigned = assignment.get("units_assigned", capacity * trips)
                for i in range(trips):
                    per_trip_qty = capacity if i < trips - 1 else units_assigned - capacity * (trips - 1)
                    row = await conn.fetchrow(
                        "INSERT INTO tasks "
                        "(type, status, forklift_id, origin_zone, destination_zone, "
                        " inventory_item_id, planned_quantity, created_at, updated_at) "
                        "VALUES ($1::task_type, 'pending', $2, $3, $4, $5, $6, NOW(), NOW()) "
                        "RETURNING id",
                        task_type, fid, origin, destination, item_id, per_trip_qty,
                    )
                    task_ids.append(row["id"])

            await conn.execute(
                "INSERT INTO events (type, payload, timestamp) VALUES ($1, $2, NOW())",
                "ai_task_execution",
                {
                    "task_type":       task_type,
                    "item_id":         item_id,
                    "item_name":       plan.get("item_name"),
                    "quantity_planned": plan.get("quantity_planned"),
                    "total_trips":     len(task_ids),
                    "forklifts_used":  plan.get("total_forklifts_used"),
                    "task_ids":        task_ids,
                },
            )

    return {"tasks_created": len(task_ids), "task_ids": task_ids}


@router.get("/settings")
async def get_capacity_settings(
    pool: asyncpg.Pool = Depends(get_pool),
    _user: dict = Depends(get_current_user),
):
    """Return all forklifts with their current capacity settings."""
    rows = await pool.fetch(
        "SELECT id, name, status::text AS status, capacity FROM forklifts ORDER BY name"
    )
    return [dict(r) for r in rows]


@router.patch("/settings/{forklift_id}")
async def update_capacity(
    forklift_id: int,
    body: UpdateCapacityRequest,
    pool: asyncpg.Pool = Depends(get_pool),
    _user: dict = Depends(require_admin),
):
    """Update a forklift's load capacity. Admin only."""
    if not (1 <= body.capacity <= 10_000):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Capacity must be 1–10 000 units")

    row = await pool.fetchrow(
        "UPDATE forklifts SET capacity=$1 WHERE id=$2 "
        "RETURNING id, name, status::text AS status, capacity",
        body.capacity, forklift_id,
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Forklift {forklift_id} not found")

    return dict(row)
