"""
WhatsApp agentic workflow.

Per-phone-number conversation state machine:

  IDLE
   │ any message
   ▼
  CHATTING  ◀─────────────── correction from manager
   │ Claude calls confirm_intent tool
   ▼
  AWAITING_CONFIRMATION
   │ manager says yes
   ▼
  GENERATING  (Claude planning agent runs)
   │ plan ready
   ▼
  AWAITING_PLAN_APPROVAL
   │ manager says YES
   ▼
  EXECUTING  →  IDLE

"cancel" / "reset" from any state → IDLE
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import Response

from app.auth import get_current_user, require_admin
from app.dependencies import get_pool
from app.ws_manager import manager as ws_manager
from app.routers.ai_workflow import _run_agent as _run_planning_agent

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])

# ── Affirmative / negative keyword sets ──────────────────────────────────────

_YES = frozenset({
    "yes", "yeah", "yep", "yup", "ok", "okay", "correct", "right",
    "execute", "approve", "go", "go ahead", "do it", "proceed",
    "confirm", "sure", "sounds good", "perfect", "great",
})
_NO = frozenset({
    "no", "nope", "cancel", "wrong", "incorrect", "stop",
    "restart", "reset", "nevermind", "never mind", "abort", "quit",
})

def _is_affirmative(text: str) -> bool:
    return text.lower().strip().rstrip("!.,") in _YES

def _is_negative(text: str) -> bool:
    return text.lower().strip().rstrip("!.,") in _NO


# ── Twilio helpers ────────────────────────────────────────────────────────────

def _send_whatsapp(to: str, body: str) -> None:
    sid   = os.getenv("TWILIO_ACCOUNT_SID", "")
    token = os.getenv("TWILIO_AUTH_TOKEN", "")
    from_ = os.getenv("TWILIO_WHATSAPP_FROM", "whatsapp:+14155238886")
    if not sid or not token:
        logger.warning("Twilio not configured — skipping send to %s", to)
        return
    try:
        from twilio.rest import Client  # noqa: PLC0415
        to_fmt = f"whatsapp:{to}" if not to.startswith("whatsapp:") else to
        Client(sid, token).messages.create(from_=from_, body=body, to=to_fmt)
    except Exception as exc:
        logger.error("Twilio send failed: %s", exc)


def _validate_twilio_signature(request: Request, form_dict: dict) -> bool:
    token = os.getenv("TWILIO_AUTH_TOKEN", "")
    if not token:
        return True  # skip validation when token not set (dev mode)
    try:
        from twilio.request_validator import RequestValidator  # noqa: PLC0415
        v = RequestValidator(token)
        return v.validate(str(request.url), form_dict, request.headers.get("X-Twilio-Signature", ""))
    except Exception:
        return False


# ── DB helpers ────────────────────────────────────────────────────────────────

_UNSET = object()  # sentinel for optional pending_plan parameter


async def _get_or_create_session(conn: asyncpg.Connection, phone: str) -> dict:
    row = await conn.fetchrow(
        "SELECT id, state::text AS state, pending_plan "
        "FROM whatsapp_sessions WHERE phone_number=$1",
        phone,
    )
    if not row:
        row = await conn.fetchrow(
            "INSERT INTO whatsapp_sessions (phone_number) VALUES ($1) "
            "RETURNING id, state::text AS state, pending_plan",
            phone,
        )
    return dict(row)


async def _update_session(
    conn: asyncpg.Connection,
    session_id: int,
    state: str,
    pending_plan: Any = _UNSET,
) -> None:
    if pending_plan is _UNSET:
        await conn.execute(
            "UPDATE whatsapp_sessions "
            "SET state=$1::whatsapp_session_state, updated_at=NOW() WHERE id=$2",
            state, session_id,
        )
    else:
        await conn.execute(
            "UPDATE whatsapp_sessions "
            "SET state=$1::whatsapp_session_state, pending_plan=$2, updated_at=NOW() WHERE id=$3",
            state, pending_plan, session_id,
        )


async def _save_message(
    conn: asyncpg.Connection, session_id: int, direction: str, content: str,
) -> None:
    await conn.execute(
        "INSERT INTO whatsapp_messages (session_id, direction, content) "
        "VALUES ($1, $2::whatsapp_message_direction, $3)",
        session_id, direction, content,
    )


async def _get_messages(conn: asyncpg.Connection, session_id: int) -> list[dict]:
    rows = await conn.fetch(
        "SELECT direction::text AS direction, content, timestamp "
        "FROM whatsapp_messages WHERE session_id=$1 ORDER BY timestamp ASC",
        session_id,
    )
    return [dict(r) for r in rows]


async def _send_and_save(
    conn: asyncpg.Connection,
    session_id: int,
    phone: str,
    reply: str,
    extra_ws: dict | None = None,
) -> None:
    """Persist outbound message, send via Twilio, broadcast to dashboard WebSocket."""
    await _save_message(conn, session_id, "outbound", reply)
    _send_whatsapp(phone, reply)
    await ws_manager.broadcast({
        "type": "whatsapp_message",
        "payload": {
            "phone_number": phone,
            "direction": "outbound",
            "content": reply,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            **(extra_ws or {}),
        },
    })


# ── Phase 1: Intent extraction (Claude with confirm_intent tool) ───────────────

_INTENT_TOOL = {
    "name": "confirm_intent",
    "description": (
        "Call this when you have fully understood the manager's request and are ready "
        "to send a concise confirmation summary. Do NOT call it if you still need "
        "more information — ask a single clarifying question instead."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "summary": {
                "type": "string",
                "description": "One-line summary (e.g. 'Outbound 300 units of Safety Gloves L')",
            },
            "task_type": {
                "type": "string",
                "enum": ["inbound", "outbound", "relocation", "replenishment"],
            },
            "item_query": {
                "type": "string",
                "description": "Item name as the manager described it",
            },
            "quantity": {
                "type": "integer",
                "description": "Number of units to move",
            },
            "origin_zone": {
                "type": "string",
                "description": "Pickup zone (e.g. 'A1', 'DOCK') — omit if task type implies it",
            },
            "destination_zone": {
                "type": "string",
                "description": "Delivery zone (e.g. 'SHIP', 'B3') — omit if task type implies it",
            },
        },
        "required": ["summary", "task_type", "item_query", "quantity"],
    },
}

_INTENT_SYSTEM = """\
You are a warehouse task intake assistant on WhatsApp.

Warehouse task types:
- outbound: zone → SHIP (shipping dock)
- inbound: DOCK (receiving dock) → zone
- relocation: zone → zone
- replenishment: STOR (storage) → low-stock zone

Rules:
1. When you fully understand the task (type, item name, quantity), call confirm_intent immediately.
2. If key info is missing, ask ONE short clarifying question.
3. Keep messages brief — this is WhatsApp.
4. Do NOT ask for zones when the task type already implies them (outbound → SHIP, inbound → from DOCK).
5. Never mention tools or internal processes.\
"""


async def _run_intent_agent(claude_messages: list[dict]) -> dict[str, Any]:
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        return {"intent": None, "text": "AI is not configured. Please contact your administrator."}

    import anthropic as _anthropic  # noqa: PLC0415

    client = _anthropic.AsyncAnthropic(api_key=api_key)
    response = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=512,
        system=_INTENT_SYSTEM,
        tools=[_INTENT_TOOL],
        messages=claude_messages,
    )
    intent, text = None, ""
    for block in response.content:
        if hasattr(block, "text"):
            text = block.text
        if block.type == "tool_use" and block.name == "confirm_intent":
            intent = dict(block.input)
    return {"intent": intent, "text": text}


def _to_claude_messages(messages: list[dict]) -> list[dict]:
    """Convert DB message rows into Claude conversation turns."""
    return [
        {"role": "user" if m["direction"] == "inbound" else "assistant", "content": m["content"]}
        for m in messages
    ]


# ── Plan formatting for WhatsApp ──────────────────────────────────────────────

def _fmt_seconds(s: int) -> str:
    m, sec = divmod(s, 60)
    return f"{m}m {sec}s" if m else f"{sec}s"


def _format_plan(plan: dict) -> str:
    lines = [
        "✅ *Plan Ready*\n",
        f"📦 *{plan['quantity_planned']} units* of {plan['item_name']}",
        f"📍 {plan['origin_zone']} → {plan['destination_zone']} _({plan['task_type'].capitalize()})_\n",
        "*Forklift Assignments:*",
    ]
    for a in plan["assignments"]:
        lines.append(
            f"• {a['forklift_name']}: {a['trips']} trip(s) · "
            f"{a['units_assigned']} units · ~{_fmt_seconds(a['estimated_seconds'])}"
        )
    lines += [
        f"\n⏱ *Est. completion: {_fmt_seconds(plan['makespan_s'])}*",
        f"📋 {plan['total_trips']} task(s) will be created",
    ]
    if plan.get("insufficient_stock"):
        lines.append(
            f"\n⚠ Only {plan['quantity_available']} units available "
            f"(you requested {plan['quantity_requested']})."
        )
    lines.append("\nReply *YES* to execute or *CANCEL* to abort.")
    return "\n".join(lines)


# ── Authorized number guard ───────────────────────────────────────────────────

def _is_authorized(phone: str) -> bool:
    raw = os.getenv("WHATSAPP_ALLOWED_NUMBERS", "")
    if not raw.strip():
        return True  # no whitelist configured → allow everyone
    allowed = {n.strip() for n in raw.split(",") if n.strip()}
    return phone in allowed


# ── Core message handler ──────────────────────────────────────────────────────

async def handle_incoming(phone: str, body: str, pool: asyncpg.Pool) -> None:
    try:
        # Fetch/create session and persist inbound message
        async with pool.acquire() as conn:
            session = await _get_or_create_session(conn, phone)
            await _save_message(conn, session["id"], "inbound", body)

        # Broadcast inbound to dashboard
        await ws_manager.broadcast({
            "type": "whatsapp_message",
            "payload": {
                "phone_number": phone,
                "direction": "inbound",
                "content": body,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "state": session["state"],
            },
        })

        # Authorization check
        if not _is_authorized(phone):
            async with pool.acquire() as conn:
                session = await _get_or_create_session(conn, phone)
                await _send_and_save(
                    conn, session["id"], phone,
                    "Sorry, you are not authorised to use this system.",
                )
            return

        state = session["state"]

        # ── Dispatch by state ─────────────────────────────────────────────────
        if state in ("idle", "chatting"):
            await _handle_chatting(phone, session, pool)

        elif state == "awaiting_confirmation":
            if _is_affirmative(body):
                await _handle_confirmed(phone, session, pool)
            elif _is_negative(body):
                async with pool.acquire() as conn:
                    await _update_session(conn, session["id"], "idle", pending_plan=None)
                    await _send_and_save(
                        conn, session["id"], phone,
                        "Okay, cancelled. Let me know when you have a new task.",
                        extra_ws={"state": "idle"},
                    )
            else:
                # Manager is correcting — go back to chatting with updated history
                async with pool.acquire() as conn:
                    await _update_session(conn, session["id"], "chatting")
                await _handle_chatting(phone, session, pool)

        elif state == "awaiting_plan_approval":
            if _is_affirmative(body):
                await _handle_execute(phone, session, pool)
            elif _is_negative(body):
                async with pool.acquire() as conn:
                    await _update_session(conn, session["id"], "idle", pending_plan=None)
                    await _send_and_save(
                        conn, session["id"], phone,
                        "Plan cancelled. Let me know when you need something.",
                        extra_ws={"state": "idle"},
                    )
            else:
                async with pool.acquire() as conn:
                    await _send_and_save(
                        conn, session["id"], phone,
                        "Reply *YES* to execute the plan or *CANCEL* to abort.",
                    )

        elif state in ("generating", "executing"):
            async with pool.acquire() as conn:
                await _send_and_save(
                    conn, session["id"], phone,
                    "Please wait — I'm still working on your previous request. ⏳",
                )

    except Exception as exc:
        logger.error("Error handling WhatsApp message from %s: %s", phone, exc, exc_info=True)


async def _handle_chatting(phone: str, session: dict, pool: asyncpg.Pool) -> None:
    session_id = session["id"]

    async with pool.acquire() as conn:
        await _update_session(conn, session_id, "chatting")
        messages = await _get_messages(conn, session_id)

    result = await _run_intent_agent(_to_claude_messages(messages))

    if result["intent"]:
        intent = result["intent"]
        confirmation = (
            f"Got it:\n\n"
            f"*{intent['summary']}*\n\n"
            f"Is that correct? Reply *YES* to proceed or correct me."
        )
        async with pool.acquire() as conn:
            await _update_session(
                conn, session_id, "awaiting_confirmation",
                pending_plan={"intent": intent},
            )
            await _send_and_save(
                conn, session_id, phone, confirmation,
                extra_ws={"state": "awaiting_confirmation"},
            )
    else:
        reply = result["text"] or "Could you tell me more about what you need?"
        async with pool.acquire() as conn:
            await _send_and_save(conn, session_id, phone, reply)


async def _handle_confirmed(phone: str, session: dict, pool: asyncpg.Pool) -> None:
    session_id = session["id"]
    pending    = session.get("pending_plan") or {}
    intent     = pending.get("intent")

    if not intent:
        async with pool.acquire() as conn:
            await _update_session(conn, session_id, "idle", pending_plan=None)
            await _send_and_save(
                conn, session_id, phone,
                "Something went wrong. Please describe your task again.",
            )
        return

    async with pool.acquire() as conn:
        await _update_session(conn, session_id, "generating")
        await _send_and_save(
            conn, session_id, phone,
            "Great! Generating the optimal forklift plan now... ⏳",
            extra_ws={"state": "generating"},
        )

    # Build a clean planning message from the extracted intent
    zone_hint = ""
    if intent.get("origin_zone") and intent.get("destination_zone"):
        zone_hint = f" from {intent['origin_zone']} to {intent['destination_zone']}"
    elif intent.get("origin_zone"):
        zone_hint = f" from {intent['origin_zone']}"
    elif intent.get("destination_zone"):
        zone_hint = f" to {intent['destination_zone']}"

    planning_msg = (
        f"{intent['task_type']} {intent['quantity']} units "
        f"of {intent['item_query']}{zone_hint}"
    )

    try:
        async with pool.acquire() as conn:
            result = await _run_planning_agent(planning_msg, conn)
    except Exception as exc:
        logger.error("Planning agent error for %s: %s", phone, exc)
        async with pool.acquire() as conn:
            await _update_session(conn, session_id, "idle", pending_plan=None)
            await _send_and_save(
                conn, session_id, phone,
                f"Sorry, the planner ran into an error: {exc}. Please try again.",
                extra_ws={"state": "idle"},
            )
        return

    plan = result.get("plan")
    if not plan or not plan.get("ok"):
        error = (plan or {}).get("error", "Could not generate a plan for this request.")
        async with pool.acquire() as conn:
            await _update_session(conn, session_id, "idle", pending_plan=None)
            await _send_and_save(
                conn, session_id, phone,
                f"⚠ {error}",
                extra_ws={"state": "idle"},
            )
        return

    plan_text = _format_plan(plan)
    async with pool.acquire() as conn:
        await _update_session(
            conn, session_id, "awaiting_plan_approval",
            pending_plan={"intent": intent, "plan": plan},
        )
        await _send_and_save(
            conn, session_id, phone, plan_text,
            extra_ws={"state": "awaiting_plan_approval", "plan": plan},
        )


async def _handle_execute(phone: str, session: dict, pool: asyncpg.Pool) -> None:
    session_id = session["id"]
    pending    = session.get("pending_plan") or {}
    plan       = pending.get("plan")

    if not plan or not plan.get("ok"):
        async with pool.acquire() as conn:
            await _update_session(conn, session_id, "idle", pending_plan=None)
            await _send_and_save(
                conn, session_id, phone,
                "The plan is no longer valid. Please start over.",
            )
        return

    async with pool.acquire() as conn:
        await _update_session(conn, session_id, "executing")

    task_ids: list[int] = []
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                for assignment in plan.get("assignments", []):
                    per_trip_qty = assignment.get("capacity", 50)
                    for _ in range(assignment["trips"]):
                        row = await conn.fetchrow(
                            "INSERT INTO tasks "
                            "(type, status, origin_zone, destination_zone, "
                            " inventory_item_id, planned_quantity, created_at, updated_at) "
                            "VALUES ($1::task_type, 'pending', $2, $3, $4, $5, NOW(), NOW()) "
                            "RETURNING id",
                            plan["task_type"], plan["origin_zone"],
                            plan["destination_zone"], plan["item_id"], per_trip_qty,
                        )
                        task_ids.append(row["id"])

                await conn.execute(
                    "INSERT INTO events (type, payload, timestamp) VALUES ($1, $2, NOW())",
                    "whatsapp_task_execution",
                    {
                        "phone_number": phone,
                        "task_type": plan["task_type"],
                        "item_name": plan.get("item_name"),
                        "quantity_planned": plan.get("quantity_planned"),
                        "total_trips": len(task_ids),
                        "task_ids": task_ids,
                    },
                )

        reply = (
            f"✅ *Done!* {len(task_ids)} task(s) created.\n"
            f"Forklifts are being dispatched to handle *{plan['item_name']}*.\n\n"
            f"Track progress on the dashboard."
        )
        async with pool.acquire() as conn:
            await _update_session(conn, session_id, "idle", pending_plan=None)
            await _send_and_save(
                conn, session_id, phone, reply,
                extra_ws={"state": "idle", "tasks_created": len(task_ids)},
            )

    except Exception as exc:
        logger.error("Execute failed for %s: %s", phone, exc)
        async with pool.acquire() as conn:
            await _update_session(conn, session_id, "idle", pending_plan=None)
            await _send_and_save(
                conn, session_id, phone,
                "Something went wrong executing the plan. Please try again.",
                extra_ws={"state": "idle"},
            )


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/webhook", include_in_schema=False)
async def twilio_webhook(request: Request, pool: asyncpg.Pool = Depends(get_pool)):
    """Twilio inbound WhatsApp webhook. No JWT — validated by Twilio signature."""
    form_data = await request.form()
    form_dict = dict(form_data)

    if not _validate_twilio_signature(request, form_dict):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid Twilio signature")

    phone = form_dict.get("From", "").replace("whatsapp:", "").strip()
    body  = form_dict.get("Body", "").strip()

    if phone:
        asyncio.create_task(handle_incoming(phone, body, pool))

    # Return empty TwiML immediately so Twilio doesn't retry
    return Response(
        content='<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
        media_type="text/xml",
    )


@router.get("/conversations")
async def list_conversations(
    pool: asyncpg.Pool = Depends(get_pool),
    _user: dict = Depends(get_current_user),
):
    rows = await pool.fetch(
        "SELECT s.id, s.phone_number, s.state::text AS state, "
        "       s.pending_plan, s.updated_at, "
        "       m.content AS last_message "
        "FROM whatsapp_sessions s "
        "LEFT JOIN LATERAL ("
        "  SELECT content FROM whatsapp_messages "
        "  WHERE session_id = s.id ORDER BY timestamp DESC LIMIT 1"
        ") m ON TRUE "
        "ORDER BY s.updated_at DESC"
    )
    return [
        {
            "id": r["id"],
            "phone_number": r["phone_number"],
            "state": r["state"],
            "last_message": r["last_message"],
            "updated_at": r["updated_at"].isoformat(),
            "has_pending_plan": bool(
                r["pending_plan"] and r["pending_plan"].get("plan")
            ),
        }
        for r in rows
    ]


@router.get("/conversations/{phone_number:path}")
async def get_conversation(
    phone_number: str,
    pool: asyncpg.Pool = Depends(get_pool),
    _user: dict = Depends(get_current_user),
):
    session = await pool.fetchrow(
        "SELECT id, phone_number, state::text AS state, pending_plan, updated_at "
        "FROM whatsapp_sessions WHERE phone_number=$1",
        phone_number,
    )
    if not session:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")

    messages = await pool.fetch(
        "SELECT direction::text AS direction, content, timestamp "
        "FROM whatsapp_messages WHERE session_id=$1 ORDER BY timestamp ASC",
        session["id"],
    )
    pending = session["pending_plan"] or {}

    return {
        "phone_number": session["phone_number"],
        "state": session["state"],
        "pending_plan": pending.get("plan"),
        "updated_at": session["updated_at"].isoformat(),
        "messages": [
            {
                "direction": m["direction"],
                "content": m["content"],
                "timestamp": m["timestamp"].isoformat(),
            }
            for m in messages
        ],
    }


@router.post("/conversations/{phone_number:path}/execute")
async def execute_from_dashboard(
    phone_number: str,
    pool: asyncpg.Pool = Depends(get_pool),
    _user: dict = Depends(require_admin),
):
    """Admin override — approve a pending plan directly from the dashboard."""
    session = await pool.fetchrow(
        "SELECT id, state::text AS state, pending_plan "
        "FROM whatsapp_sessions WHERE phone_number=$1",
        phone_number,
    )
    if not session:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    if session["state"] != "awaiting_plan_approval":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No pending plan to execute")

    await _handle_execute(phone_number, dict(session), pool)
    return {"status": "ok"}


@router.delete("/conversations/{phone_number:path}", status_code=204)
async def reset_conversation(
    phone_number: str,
    pool: asyncpg.Pool = Depends(get_pool),
    _user: dict = Depends(require_admin),
):
    """Admin override — reset a conversation to idle."""
    await pool.execute(
        "UPDATE whatsapp_sessions "
        "SET state='idle', pending_plan=NULL, updated_at=NOW() "
        "WHERE phone_number=$1",
        phone_number,
    )
