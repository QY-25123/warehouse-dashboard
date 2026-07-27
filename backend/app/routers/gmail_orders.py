"""
Gmail order intake router.

Flow:
  GET  /gmail/emails                    list recent emails from monitored sender (via MCP)
  POST /gmail/emails/{id}/extract       Claude reads email via MCP → saves to email_orders
  GET  /gmail/orders                    list all stored email_orders
  GET  /gmail/orders/{id}              get single order
  PATCH /gmail/orders/{id}             manager corrects extracted fields
  POST /gmail/orders/{id}/approve      generate AI plan → insert tasks → mark executed
  DELETE /gmail/orders/{id}            reject / dismiss order
"""

import logging
import os
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import get_current_user
from app.dependencies import get_pool
from app.mcp_gmail_client import extract_order_from_email, list_emails
from app.routers.ai_workflow import _run_agent as _run_planning_agent

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/gmail", tags=["gmail"])

_MONITORED_SENDER = os.getenv("GMAIL_MONITORED_SENDER", "qijie_jerry@163.com")

# Fields the manager is allowed to patch (allowlist prevents SQL injection)
_PATCHABLE: dict[str, str] = {
    "extracted_item_name":         "extracted_item_name",
    "extracted_quantity":          "extracted_quantity",
    "extracted_destination_zone":  "extracted_destination_zone",
    "extracted_notes":             "extracted_notes",
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _row_to_dict(row: asyncpg.Record) -> dict[str, Any]:
    return {
        "id":                         row["id"],
        "message_id":                 row["message_id"],
        "sender":                     row["sender"],
        "subject":                    row["subject"],
        "email_body":                 row["email_body"],
        "received_at":                row["received_at"].isoformat() if row["received_at"] else None,
        "extracted_item_name":        row["extracted_item_name"],
        "extracted_quantity":         row["extracted_quantity"],
        "extracted_destination_zone": row["extracted_destination_zone"],
        "extracted_notes":            row["extracted_notes"],
        "status":                     row["status"],
        "plan":                       row["plan"],
        "task_ids":                   list(row["task_ids"]) if row["task_ids"] else None,
        "created_at":                 row["created_at"].isoformat(),
    }


# ── Email inbox (via MCP) ─────────────────────────────────────────────────────

@router.get("/emails")
async def get_emails(_user: dict = Depends(get_current_user)):
    """List recent emails from the monitored sender via Gmail MCP."""
    try:
        emails = await list_emails(_MONITORED_SENDER, max_results=15)
        return emails
    except Exception as exc:
        logger.error("Gmail list_emails failed: %s", exc)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail=f"Gmail API error: {exc}",
        )


# ── Extract order from one email ──────────────────────────────────────────────

@router.post("/emails/{message_id}/extract")
async def extract_order(
    message_id: str,
    pool: asyncpg.Pool = Depends(get_pool),
    _user: dict = Depends(get_current_user),
):
    """Claude reads the email via MCP and extracts a structured outbound order."""
    # Return cached result if this email was already processed
    existing = await pool.fetchrow(
        "SELECT * FROM email_orders WHERE message_id=$1", message_id
    )
    if existing:
        return _row_to_dict(existing)

    try:
        result = await extract_order_from_email(message_id)
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except Exception as exc:
        logger.error("MCP extraction failed for %s: %s", message_id, exc)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail=f"Extraction failed: {exc}",
        )

    email = result.get("email") or {}
    order = result.get("order") or {}

    # Enforce sender restriction — the From header may be "Name <addr>", so use substring match
    actual_sender = email.get("sender", "")
    if _MONITORED_SENDER.lower() not in actual_sender.lower():
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"Email is not from the monitored sender ({_MONITORED_SENDER}).",
        )

    if not order.get("is_order"):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No outbound order found in this email.",
        )

    row = await pool.fetchrow(
        """
        INSERT INTO email_orders
          (message_id, sender, subject, email_body, received_at,
           extracted_item_name, extracted_quantity, extracted_destination_zone,
           extracted_notes, status)
        VALUES ($1,$2,$3,$4,NOW(),$5,$6,$7,$8,'pending_review')
        RETURNING *
        """,
        message_id,
        email.get("sender", _MONITORED_SENDER),
        email.get("subject"),
        email.get("body"),
        order.get("item_name"),
        order.get("quantity"),
        order.get("destination_zone") or "SHIP",
        order.get("notes"),
    )
    return _row_to_dict(row)


# ── Order CRUD ────────────────────────────────────────────────────────────────

@router.get("/orders")
async def list_orders(
    pool: asyncpg.Pool = Depends(get_pool),
    _user: dict = Depends(get_current_user),
):
    rows = await pool.fetch(
        "SELECT * FROM email_orders ORDER BY created_at DESC LIMIT 50"
    )
    return [_row_to_dict(r) for r in rows]


@router.get("/orders/{order_id}")
async def get_order(
    order_id: int,
    pool: asyncpg.Pool = Depends(get_pool),
    _user: dict = Depends(get_current_user),
):
    row = await pool.fetchrow("SELECT * FROM email_orders WHERE id=$1", order_id)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    return _row_to_dict(row)


@router.patch("/orders/{order_id}")
async def patch_order(
    order_id: int,
    body: dict[str, Any],
    pool: asyncpg.Pool = Depends(get_pool),
    _user: dict = Depends(get_current_user),
):
    """Manager corrects extracted fields before approving."""
    updates = {_PATCHABLE[k]: v for k, v in body.items() if k in _PATCHABLE}
    if not updates:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No valid fields to update")

    # Build parameterised SET clause from the allowlisted field names
    fields = list(updates.keys())
    values = list(updates.values())
    set_clause = ", ".join(f"{f}=${i + 2}" for i, f in enumerate(fields))

    row = await pool.fetchrow(
        f"UPDATE email_orders SET {set_clause} "
        f"WHERE id=$1 AND status='pending_review' RETURNING *",
        order_id,
        *values,
    )
    if not row:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "Order not found or not editable"
        )
    return _row_to_dict(row)


# ── Approve → plan → execute ──────────────────────────────────────────────────

@router.post("/orders/{order_id}/approve")
async def approve_order(
    order_id: int,
    pool: asyncpg.Pool = Depends(get_pool),
    _user: dict = Depends(get_current_user),
):
    """
    Generate an AI execution plan for the order and immediately create tasks.
    Uses the same planner as the /ai/plan + /ai/execute flow.
    """
    row = await pool.fetchrow(
        "SELECT * FROM email_orders WHERE id=$1 AND status='pending_review'",
        order_id,
    )
    if not row:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "Order not found or already processed"
        )

    item_name   = row["extracted_item_name"]
    quantity    = row["extracted_quantity"]
    destination = row["extracted_destination_zone"] or "SHIP"

    if not item_name or not quantity:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Item name and quantity must be set before approving",
        )

    await pool.execute(
        "UPDATE email_orders SET status='generating' WHERE id=$1", order_id
    )

    planning_msg = f"outbound {quantity} units of {item_name} to {destination}"
    try:
        async with pool.acquire() as conn:
            result = await _run_planning_agent(planning_msg, conn)
    except Exception as exc:
        await pool.execute(
            "UPDATE email_orders SET status='pending_review' WHERE id=$1", order_id
        )
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, detail=f"Planning failed: {exc}"
        )

    plan = result.get("plan")
    if not plan or not plan.get("ok"):
        await pool.execute(
            "UPDATE email_orders SET status='pending_review' WHERE id=$1", order_id
        )
        err = (plan or {}).get("error", "Could not generate a plan for this order")
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=err)

    # Insert task rows (identical logic to /ai/execute)
    task_ids: list[int] = []
    async with pool.acquire() as conn:
        async with conn.transaction():
            for assignment in plan.get("assignments", []):
                fid            = assignment.get("forklift_id")
                trips          = assignment["trips"]
                capacity       = assignment.get("capacity", 50)
                units_assigned = assignment.get("units_assigned", capacity * trips)
                for i in range(trips):
                    per_trip_qty = (
                        capacity if i < trips - 1
                        else units_assigned - capacity * (trips - 1)
                    )
                    r = await conn.fetchrow(
                        "INSERT INTO tasks "
                        "(type, status, forklift_id, origin_zone, destination_zone, "
                        " inventory_item_id, planned_quantity, source, created_at, updated_at) "
                        "VALUES ('outbound','pending',$1,$2,$3,$4,$5,'gmail',NOW(),NOW()) "
                        "RETURNING id",
                        fid,
                        plan["origin_zone"],
                        plan["destination_zone"],
                        plan["item_id"],
                        per_trip_qty,
                    )
                    task_ids.append(r["id"])

            await conn.execute(
                "UPDATE email_orders SET status='executed', plan=$1, task_ids=$2 WHERE id=$3",
                plan,
                task_ids,
                order_id,
            )

            await conn.execute(
                "INSERT INTO events (type, payload, timestamp) VALUES ($1,$2,NOW())",
                "gmail_order_executed",
                {
                    "order_id":      order_id,
                    "item_name":     plan.get("item_name"),
                    "quantity":      plan.get("quantity_planned"),
                    "total_trips":   len(task_ids),
                    "task_ids":      task_ids,
                },
            )

    return {
        "status": "executed",
        "tasks_created": len(task_ids),
        "task_ids": task_ids,
        "plan": plan,
    }


# ── Reject ────────────────────────────────────────────────────────────────────

@router.delete("/orders/{order_id}", status_code=204)
async def reject_order(
    order_id: int,
    pool: asyncpg.Pool = Depends(get_pool),
    _user: dict = Depends(get_current_user),
):
    await pool.execute(
        "UPDATE email_orders SET status='rejected' "
        "WHERE id=$1 AND status IN ('pending_review','generating')",
        order_id,
    )
