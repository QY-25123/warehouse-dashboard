"""
Gmail background poller.

Every GMAIL_POLL_INTERVAL seconds (default 60), fetches recent emails from
GMAIL_MONITORED_SENDER, auto-extracts outbound orders via MCP + Claude, and
saves new ones to email_orders. Broadcasts a WS 'gmail_order' event so the
dashboard updates in real time without a page refresh.

Emails that contain no order are saved with status='rejected' so they are
not re-processed on the next poll tick.
"""

import asyncio
import logging
import os

import asyncpg

from app.mcp_gmail_client import extract_order_from_email, list_emails
from app.ws_manager import manager as ws_manager

logger = logging.getLogger(__name__)

_SENDER   = os.getenv("GMAIL_MONITORED_SENDER", "qijie_jerry@163.com")
_INTERVAL = int(os.getenv("GMAIL_POLL_INTERVAL", "60"))


async def run(pool: asyncpg.Pool) -> None:
    logger.info("Gmail poller started (sender=%s, interval=%ds)", _SENDER, _INTERVAL)
    while True:
        try:
            await _poll(pool)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error("Gmail poller error: %s", exc, exc_info=True)
        await asyncio.sleep(_INTERVAL)


async def _poll(pool: asyncpg.Pool) -> None:
    try:
        emails = await list_emails(_SENDER, max_results=10)
    except Exception as exc:
        logger.warning("Gmail list_emails failed: %s", exc, exc_info=True)
        if hasattr(exc, 'exceptions'):
            for i, sub in enumerate(exc.exceptions):
                logger.warning("  sub-exception %d: %s", i, sub, exc_info=(type(sub), sub, sub.__traceback__))
        return

    for email in emails:
        message_id = email["id"]

        # Skip already-processed messages (any status)
        exists = await pool.fetchval(
            "SELECT 1 FROM email_orders WHERE message_id=$1", message_id
        )
        if exists:
            continue

        logger.info("New email detected (id=%s) — extracting order", message_id)
        try:
            result = await extract_order_from_email(message_id)
        except Exception as exc:
            logger.error("Extraction failed for %s: %s", message_id, exc)
            continue

        order      = result.get("order") or {}
        email_data = result.get("email") or {}
        is_order   = order.get("is_order", False)
        task_type  = order.get("task_type") if is_order else None

        _DEFAULT_ORIGIN = {"inbound": "DOCK", "replenishment": "STOR"}
        _DEFAULT_DEST   = {"outbound": "SHIP"}
        origin_zone = (order.get("origin_zone") or _DEFAULT_ORIGIN.get(task_type or "")) if is_order else None
        dest_zone   = (order.get("destination_zone") or _DEFAULT_DEST.get(task_type or "")) if is_order else None

        # Save to DB — always pending_review so humans can review even if Claude
        # found no order (extraction may fail on HTML-only emails or ambiguous content).
        row = await pool.fetchrow(
            """
            INSERT INTO email_orders
              (message_id, sender, subject, email_body, received_at,
               extracted_task_type, extracted_item_name, extracted_quantity,
               extracted_origin_zone, extracted_destination_zone, extracted_notes, status)
            VALUES ($1,$2,$3,$4,NOW(),$5,$6,$7,$8,$9,$10,'pending_review')
            ON CONFLICT (message_id) DO NOTHING
            RETURNING id, status
            """,
            message_id,
            email_data.get("sender", _SENDER),
            email_data.get("subject"),
            email_data.get("body"),
            task_type,
            order.get("item_name") if is_order else None,
            order.get("quantity")  if is_order else None,
            origin_zone,
            dest_zone,
            order.get("notes")     if is_order else None,
        )

        if row:
            logger.info(
                "Email order #%s created (is_order=%s) — %s × %s",
                row["id"], is_order, order.get("item_name"), order.get("quantity"),
            )
            await ws_manager.broadcast({
                "type": "gmail_order",
                "payload": {
                    "order_id":    row["id"],
                    "message_id":  message_id,
                    "subject":     email_data.get("subject"),
                    "item_name":   order.get("item_name"),
                    "quantity":    order.get("quantity"),
                },
            })
