import asyncio
import logging
import os

import asyncpg

logger = logging.getLogger(__name__)

POLL_INTERVAL = 60  # seconds


async def run(pool: asyncpg.Pool) -> None:
    logger.info("Sheets poller started (interval=%ds)", POLL_INTERVAL)
    while True:
        try:
            await _poll(pool)
        except Exception as exc:
            logger.error("Sheets poller error: %s", exc, exc_info=True)
        await asyncio.sleep(POLL_INTERVAL)


async def _poll(pool: asyncpg.Pool) -> None:
    sheet_id = os.getenv("GOOGLE_SHEET_ID", "").strip()
    sheet_name = os.getenv("GOOGLE_SHEET_NAME", "Sheet1").strip()
    if not sheet_id:
        return

    from app.sheets_client import open_worksheet  # noqa: PLC0415

    loop = asyncio.get_event_loop()
    ws, records = await loop.run_in_executor(
        None, lambda: _read_sheet(open_worksheet, sheet_id, sheet_name)
    )

    async with pool.acquire() as conn:
        await _import_pending_rows(conn, records)
        completed = await _fetch_completed(conn)

    if completed:
        await loop.run_in_executor(
            None,
            lambda: _write_completed(open_worksheet, sheet_id, sheet_name, completed),
        )


def _read_sheet(open_ws_fn, sheet_id: str, sheet_name: str):
    ws = open_ws_fn(sheet_id, sheet_name)
    return ws, ws.get_all_records()


async def _import_pending_rows(conn: asyncpg.Connection, records: list[dict]) -> None:
    from app.routers.ai_workflow import _compute_plan, _tool_get_forklifts  # noqa: PLC0415

    for idx, row in enumerate(records, start=2):
        if row.get("Status", "").strip().lower() != "pending":
            continue

        # Skip if tasks already created for this sheet row
        existing = await conn.fetchval(
            "SELECT id FROM tasks WHERE source='google_sheets' AND sheet_row_index=$1 LIMIT 1",
            idx,
        )
        if existing:
            continue

        item_name = row.get("Item Name", "").strip()
        item_row = await conn.fetchrow(
            "SELECT id, item_name, quantity FROM inventory WHERE item_name ILIKE $1 LIMIT 1",
            item_name,
        )
        if not item_row:
            logger.warning("Sheet row %d: item '%s' not found in inventory", idx, item_name)
            continue

        task_type = row.get("Task Type", "").strip().lower()
        if task_type not in {"inbound", "outbound", "replenishment", "relocation"}:
            logger.warning("Sheet row %d: unknown task type '%s'", idx, task_type)
            continue

        try:
            quantity = int(row.get("Quantity") or 0)
        except (ValueError, TypeError):
            quantity = 0
        if quantity <= 0:
            logger.warning("Sheet row %d: invalid quantity", idx)
            continue

        origin = (row.get("Origin Zone") or "").strip() or None
        destination = (row.get("Destination Zone") or "").strip() or None

        # Validate required zones per task type
        missing = []
        if task_type == "outbound" and not origin:
            missing.append("Origin Zone")
        if task_type == "inbound" and not destination:
            missing.append("Destination Zone")
        if task_type == "replenishment" and not destination:
            missing.append("Destination Zone")
        if task_type == "relocation" and not origin:
            missing.append("Origin Zone")
        if task_type == "relocation" and not destination:
            missing.append("Destination Zone")
        if missing:
            logger.warning("Sheet row %d: incomplete — missing %s", idx, ", ".join(missing))
            continue

        # For inbound/replenishment goods come from outside so stock doesn't cap the qty
        if task_type in ("inbound", "replenishment"):
            available_qty = quantity
        else:
            available_qty = int(item_row["quantity"])

        # Get idle forklifts and compute the optimal plan
        forklifts = await _tool_get_forklifts(conn)
        if not forklifts:
            logger.warning("Sheet row %d: no idle forklifts available, will retry next poll", idx)
            continue

        plan = _compute_plan(
            task_type=task_type,
            item_id=item_row["id"],
            item_name=item_row["item_name"],
            quantity=quantity,
            available_quantity=available_qty,
            origin_zone=origin or "DOCK",
            destination_zone=destination or "A1",
            forklifts=list(forklifts),  # _compute_plan mutates the list
        )

        if not plan.get("ok"):
            logger.warning("Sheet row %d: planning failed — %s", idx, plan.get("error"))
            continue

        # Create one task per forklift trip (same as ai_workflow execute_plan)
        task_ids = []
        try:
            for assignment in plan["assignments"]:
                fid = assignment["forklift_id"]
                trips = assignment["trips"]
                capacity = assignment.get("capacity", 50)
                units_assigned = assignment.get("units_assigned", capacity * trips)
                for i in range(trips):
                    per_trip_qty = (
                        capacity if i < trips - 1
                        else units_assigned - capacity * (trips - 1)
                    )
                    task = await conn.fetchrow(
                        "INSERT INTO tasks "
                        "  (type, status, forklift_id, origin_zone, destination_zone, "
                        "   inventory_item_id, planned_quantity, source, sheet_row_index, "
                        "   created_at, updated_at) "
                        "VALUES ($1::task_type, 'pending', $2, $3, $4, $5, $6, "
                        "        'google_sheets', $7, NOW(), NOW()) "
                        "RETURNING id",
                        task_type, fid, origin, destination,
                        item_row["id"], per_trip_qty, idx,
                    )
                    task_ids.append(task["id"])

            logger.info(
                "Sheet row %d: created %d task(s) for '%s' using %d forklift(s)",
                idx, len(task_ids), item_name, plan["total_forklifts_used"],
            )
        except Exception as exc:
            logger.warning("Sheet row %d: task creation failed — %s", idx, exc)


async def _fetch_completed(conn: asyncpg.Connection) -> list[dict]:
    """Return sheet rows where ALL tasks for that row are now completed."""
    rows = await conn.fetch(
        """
        SELECT
            t.sheet_row_index,
            MAX(t.updated_at) AS updated_at,
            STRING_AGG(DISTINCT f.name, ', ' ORDER BY f.name) AS forklift_names
        FROM tasks t
        LEFT JOIN forklifts f ON f.id = t.forklift_id
        WHERE t.source = 'google_sheets'
          AND t.sheet_row_index IS NOT NULL
        GROUP BY t.sheet_row_index
        HAVING COUNT(*) = COUNT(*) FILTER (WHERE t.status = 'completed')
           AND COUNT(*) > 0
        """
    )
    return [dict(r) for r in rows]


def _write_completed(
    open_ws_fn, sheet_id: str, sheet_name: str, completed: list[dict]
) -> None:
    ws = open_ws_fn(sheet_id, sheet_name)
    headers = ws.row_values(1)
    col = {h.strip(): i + 1 for i, h in enumerate(headers)}

    status_col = col.get("Status")
    forklift_col = col.get("Assigned Forklift")
    completed_col = col.get("Completed At")

    for r in completed:
        ri = r["sheet_row_index"]
        if status_col:
            ws.update_cell(ri, status_col, "Completed")
        if forklift_col and r.get("forklift_names"):
            ws.update_cell(ri, forklift_col, r["forklift_names"])
        if completed_col and r.get("updated_at"):
            ws.update_cell(ri, completed_col, r["updated_at"].strftime("%Y-%m-%d %H:%M:%S"))

    logger.info("Wrote %d completed rows back to sheet", len(completed))
