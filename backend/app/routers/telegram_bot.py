"""
Telegram bot agentic workflow.

Per-chat-id conversation state machine:

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

"cancel" / "no" from any state → IDLE
"""

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any

import asyncpg
import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from fastapi.responses import JSONResponse

from app.auth import get_current_user, require_admin
from app.dependencies import get_pool
from app.ws_manager import manager as ws_manager
from app.routers.ai_workflow import _run_agent as _run_planning_agent

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/telegram", tags=["telegram"])

_UNSET = object()

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


# ── Telegram helpers ──────────────────────────────────────────────────────────

async def _send_telegram(chat_id: str, text: str) -> None:
    token = os.getenv("TELEGRAM_BOT_TOKEN", "")
    if not token:
        logger.warning("TELEGRAM_BOT_TOKEN not set — skipping send to %s", chat_id)
        return
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={"chat_id": int(chat_id), "text": text, "parse_mode": "HTML"},
            )
    except Exception as exc:
        logger.error("Telegram send failed: %s", exc)


def _is_authorized(chat_id: str) -> bool:
    raw = os.getenv("TELEGRAM_ALLOWED_CHAT_IDS", "")
    if not raw.strip():
        return True
    allowed = {x.strip() for x in raw.split(",") if x.strip()}
    return chat_id in allowed


# ── DB helpers (reuse whatsapp_sessions / whatsapp_messages tables) ───────────

async def _get_or_create_session(conn: asyncpg.Connection, chat_id: str) -> dict:
    row = await conn.fetchrow(
        "SELECT id, state::text AS state, pending_plan "
        "FROM whatsapp_sessions WHERE phone_number=$1",
        chat_id,
    )
    if not row:
        row = await conn.fetchrow(
            "INSERT INTO whatsapp_sessions (phone_number) VALUES ($1) "
            "RETURNING id, state::text AS state, pending_plan",
            chat_id,
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
    chat_id: str,
    reply: str,
    extra_ws: dict | None = None,
) -> None:
    await _save_message(conn, session_id, "outbound", reply)
    await _send_telegram(chat_id, reply)
    await ws_manager.broadcast({
        "type": "telegram_message",
        "payload": {
            "phone_number": chat_id,
            "direction": "outbound",
            "content": reply,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            **(extra_ws or {}),
        },
    })


# ── Phase 1: Intent extraction (Claude with confirm_intent tool) ──────────────

_INTENT_TOOL: dict[str, Any] = {
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
You are a warehouse task intake assistant on Telegram.

Warehouse task types:
- outbound: zone → SHIP (shipping dock)
- inbound: DOCK (receiving dock) → zone
- relocation: zone → zone
- replenishment: STOR (storage) → low-stock zone

Rules:
1. When you fully understand the task (type, item name, quantity), call confirm_intent immediately.
2. If key info is missing, ask ONE short clarifying question.
3. Keep messages brief — this is a chat app.
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
    return [
        {"role": "user" if m["direction"] == "inbound" else "assistant", "content": m["content"]}
        for m in messages
    ]


# ── Plan formatting for Telegram (HTML parse mode) ────────────────────────────

def _fmt_seconds(s: int) -> str:
    m, sec = divmod(s, 60)
    return f"{m}m {sec}s" if m else f"{sec}s"


def _format_plan(plan: dict) -> str:
    lines = [
        "✅ <b>Plan Ready</b>\n",
        f"📦 <b>{plan['quantity_planned']} units</b> of {plan['item_name']}",
        f"📍 {plan['origin_zone']} → {plan['destination_zone']} <i>({plan['task_type'].capitalize()})</i>\n",
        "<b>Forklift Assignments:</b>",
    ]
    for a in plan["assignments"]:
        lines.append(
            f"• {a['forklift_name']}: {a['trips']} trip(s) · "
            f"{a['units_assigned']} units · ~{_fmt_seconds(a['estimated_seconds'])}"
        )
    lines += [
        f"\n⏱ <b>Est. completion: {_fmt_seconds(plan['makespan_s'])}</b>",
        f"📋 {plan['total_trips']} task(s) will be created",
    ]
    if plan.get("insufficient_stock"):
        lines.append(
            f"\n⚠ Only {plan['quantity_available']} units available "
            f"(you requested {plan['quantity_requested']})."
        )
    lines.append("\nReply <b>YES</b> to execute or <b>CANCEL</b> to abort.")
    return "\n".join(lines)


# ── Core message handler ──────────────────────────────────────────────────────

async def handle_incoming(chat_id: str, text: str, pool: asyncpg.Pool) -> None:
    try:
        async with pool.acquire() as conn:
            session = await _get_or_create_session(conn, chat_id)
            await _save_message(conn, session["id"], "inbound", text)

        await ws_manager.broadcast({
            "type": "telegram_message",
            "payload": {
                "phone_number": chat_id,
                "direction": "inbound",
                "content": text,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "state": session["state"],
            },
        })

        if not _is_authorized(chat_id):
            async with pool.acquire() as conn:
                session = await _get_or_create_session(conn, chat_id)
                await _send_and_save(
                    conn, session["id"], chat_id,
                    "Sorry, you are not authorised to use this system.",
                )
            return

        state = session["state"]

        if state in ("idle", "chatting"):
            await _handle_chatting(chat_id, session, pool)

        elif state == "awaiting_confirmation":
            if _is_affirmative(text):
                await _handle_confirmed(chat_id, session, pool)
            elif _is_negative(text):
                async with pool.acquire() as conn:
                    await _update_session(conn, session["id"], "idle", pending_plan=None)
                    await _send_and_save(
                        conn, session["id"], chat_id,
                        "Okay, cancelled. Let me know when you have a new task.",
                        extra_ws={"state": "idle"},
                    )
            else:
                # Manager is correcting — treat as new input in chatting state
                async with pool.acquire() as conn:
                    await _update_session(conn, session["id"], "chatting")
                await _handle_chatting(chat_id, session, pool)

        elif state == "awaiting_plan_approval":
            if _is_affirmative(text):
                await _handle_execute(chat_id, session, pool)
            elif _is_negative(text):
                async with pool.acquire() as conn:
                    await _update_session(conn, session["id"], "idle", pending_plan=None)
                    await _send_and_save(
                        conn, session["id"], chat_id,
                        "Plan cancelled. Let me know when you need something.",
                        extra_ws={"state": "idle"},
                    )
            else:
                async with pool.acquire() as conn:
                    await _send_and_save(
                        conn, session["id"], chat_id,
                        "Reply <b>YES</b> to execute the plan or <b>CANCEL</b> to abort.",
                    )

        elif state in ("generating", "executing"):
            async with pool.acquire() as conn:
                await _send_and_save(
                    conn, session["id"], chat_id,
                    "Please wait — I'm still working on your previous request. ⏳",
                )

    except Exception as exc:
        logger.error("Error handling Telegram message from %s: %s", chat_id, exc, exc_info=True)


async def _handle_chatting(chat_id: str, session: dict, pool: asyncpg.Pool) -> None:
    session_id = session["id"]

    async with pool.acquire() as conn:
        await _update_session(conn, session_id, "chatting")
        messages = await _get_messages(conn, session_id)

    result = await _run_intent_agent(_to_claude_messages(messages))

    if result["intent"]:
        intent = result["intent"]
        confirmation = (
            f"Got it:\n\n"
            f"<b>{intent['summary']}</b>\n\n"
            f"Is that correct? Reply <b>YES</b> to proceed or correct me."
        )
        async with pool.acquire() as conn:
            await _update_session(
                conn, session_id, "awaiting_confirmation",
                pending_plan={"intent": intent},
            )
            await _send_and_save(
                conn, session_id, chat_id, confirmation,
                extra_ws={"state": "awaiting_confirmation"},
            )
    else:
        reply = result["text"] or "Could you tell me more about what you need?"
        async with pool.acquire() as conn:
            await _send_and_save(conn, session_id, chat_id, reply)


async def _handle_confirmed(chat_id: str, session: dict, pool: asyncpg.Pool) -> None:
    session_id = session["id"]
    pending    = session.get("pending_plan") or {}
    intent     = pending.get("intent")

    if not intent:
        async with pool.acquire() as conn:
            await _update_session(conn, session_id, "idle", pending_plan=None)
            await _send_and_save(
                conn, session_id, chat_id,
                "Something went wrong. Please describe your task again.",
            )
        return

    async with pool.acquire() as conn:
        await _update_session(conn, session_id, "generating")
        await _send_and_save(
            conn, session_id, chat_id,
            "Great! Generating the optimal forklift plan now... ⏳",
            extra_ws={"state": "generating"},
        )

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
        logger.error("Planning agent error for %s: %s", chat_id, exc)
        async with pool.acquire() as conn:
            await _update_session(conn, session_id, "idle", pending_plan=None)
            await _send_and_save(
                conn, session_id, chat_id,
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
                conn, session_id, chat_id,
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
            conn, session_id, chat_id, plan_text,
            extra_ws={"state": "awaiting_plan_approval", "plan": plan},
        )


async def _handle_execute(chat_id: str, session: dict, pool: asyncpg.Pool) -> None:
    session_id = session["id"]
    pending    = session.get("pending_plan") or {}
    plan       = pending.get("plan")

    if not plan or not plan.get("ok"):
        async with pool.acquire() as conn:
            await _update_session(conn, session_id, "idle", pending_plan=None)
            await _send_and_save(
                conn, session_id, chat_id,
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
                    fid = assignment.get("forklift_id")
                    for _ in range(assignment["trips"]):
                        row = await conn.fetchrow(
                            "INSERT INTO tasks "
                            "(type, status, forklift_id, origin_zone, destination_zone, "
                            " inventory_item_id, planned_quantity, created_at, updated_at) "
                            "VALUES ($1::task_type, 'pending', $2, $3, $4, $5, $6, NOW(), NOW()) "
                            "RETURNING id",
                            plan["task_type"], fid, plan["origin_zone"],
                            plan["destination_zone"], plan["item_id"], per_trip_qty,
                        )
                        task_ids.append(row["id"])

                await conn.execute(
                    "INSERT INTO events (type, payload, timestamp) VALUES ($1, $2, NOW())",
                    "telegram_task_execution",
                    {
                        "chat_id": chat_id,
                        "task_type": plan["task_type"],
                        "item_name": plan.get("item_name"),
                        "quantity_planned": plan.get("quantity_planned"),
                        "total_trips": len(task_ids),
                        "task_ids": task_ids,
                    },
                )

        reply = (
            f"✅ <b>Done!</b> {len(task_ids)} task(s) created.\n"
            f"Forklifts are being dispatched to handle <b>{plan['item_name']}</b>.\n\n"
            f"Track progress on the dashboard."
        )
        async with pool.acquire() as conn:
            await _update_session(conn, session_id, "idle", pending_plan=None)
            await _send_and_save(
                conn, session_id, chat_id, reply,
                extra_ws={"state": "idle", "tasks_created": len(task_ids)},
            )

    except Exception as exc:
        logger.error("Execute failed for %s: %s", chat_id, exc)
        async with pool.acquire() as conn:
            await _update_session(conn, session_id, "idle", pending_plan=None)
            await _send_and_save(
                conn, session_id, chat_id,
                "Something went wrong executing the plan. Please try again.",
                extra_ws={"state": "idle"},
            )


# ── Polling mode (local dev — no public URL needed) ───────────────────────────

async def run_polling(pool: asyncpg.Pool) -> None:
    token = os.getenv("TELEGRAM_BOT_TOKEN", "")
    if not token:
        logger.warning("TELEGRAM_BOT_TOKEN not set — polling disabled")
        return

    # Delete any registered webhook so getUpdates works
    async with httpx.AsyncClient(timeout=10) as client:
        await client.post(f"https://api.telegram.org/bot{token}/deleteWebhook")

    logger.info("Telegram polling started")
    offset = 0
    while True:
        try:
            async with httpx.AsyncClient(timeout=35) as client:
                resp = await client.get(
                    f"https://api.telegram.org/bot{token}/getUpdates",
                    params={"offset": offset, "timeout": 30},
                )
            for update in resp.json().get("result", []):
                offset = update["update_id"] + 1
                message = update.get("message") or update.get("edited_message")
                if not message:
                    continue
                chat_id = str(message["chat"]["id"])
                text = (message.get("text") or "").strip()
                if text:
                    asyncio.create_task(handle_incoming(chat_id, text, pool))
        except asyncio.CancelledError:
            logger.info("Telegram polling stopped")
            return
        except Exception as exc:
            logger.error("Telegram polling error: %s", exc)
            await asyncio.sleep(5)


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/webhook", include_in_schema=False)
async def telegram_webhook(
    request: Request,
    x_telegram_bot_api_secret_token: str = Header(default=""),
    pool: asyncpg.Pool = Depends(get_pool),
):
    """Telegram bot webhook. No JWT — validated by optional secret token header."""
    secret = os.getenv("TELEGRAM_WEBHOOK_SECRET", "")
    if secret and x_telegram_bot_api_secret_token != secret:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid secret token")

    body = await request.json()
    message = body.get("message") or body.get("edited_message")
    if not message:
        return JSONResponse({"ok": True})

    chat_id = str(message["chat"]["id"])
    text = (message.get("text") or "").strip()
    if not text:
        return JSONResponse({"ok": True})

    asyncio.create_task(handle_incoming(chat_id, text, pool))
    return JSONResponse({"ok": True})


@router.get("/setup")
async def setup_webhook(url: str, _user: dict = Depends(get_current_user)):
    """Register the Telegram webhook URL. Call once after deployment with ?url=https://yourserver/telegram/webhook"""
    token = os.getenv("TELEGRAM_BOT_TOKEN", "")
    if not token:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "TELEGRAM_BOT_TOKEN not set")
    secret = os.getenv("TELEGRAM_WEBHOOK_SECRET", "")
    payload: dict[str, Any] = {"url": url}
    if secret:
        payload["secret_token"] = secret
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"https://api.telegram.org/bot{token}/setWebhook",
            json=payload,
        )
    return resp.json()


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
            "has_pending_plan": bool(r["pending_plan"] and r["pending_plan"].get("plan")),
        }
        for r in rows
    ]


@router.get("/conversations/{chat_id:path}")
async def get_conversation(
    chat_id: str,
    pool: asyncpg.Pool = Depends(get_pool),
    _user: dict = Depends(get_current_user),
):
    session = await pool.fetchrow(
        "SELECT id, phone_number, state::text AS state, pending_plan, updated_at "
        "FROM whatsapp_sessions WHERE phone_number=$1",
        chat_id,
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


@router.post("/conversations/{chat_id:path}/execute")
async def execute_from_dashboard(
    chat_id: str,
    pool: asyncpg.Pool = Depends(get_pool),
    _user: dict = Depends(require_admin),
):
    """Admin override — approve a pending plan directly from the dashboard."""
    session = await pool.fetchrow(
        "SELECT id, state::text AS state, pending_plan "
        "FROM whatsapp_sessions WHERE phone_number=$1",
        chat_id,
    )
    if not session:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    if session["state"] != "awaiting_plan_approval":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No pending plan to execute")

    await _handle_execute(chat_id, dict(session), pool)
    return {"status": "ok"}


@router.delete("/conversations/{chat_id:path}", status_code=204)
async def reset_conversation(
    chat_id: str,
    pool: asyncpg.Pool = Depends(get_pool),
    _user: dict = Depends(require_admin),
):
    """Admin override — reset a conversation to idle."""
    await pool.execute(
        "UPDATE whatsapp_sessions "
        "SET state='idle', pending_plan=NULL, updated_at=NOW() "
        "WHERE phone_number=$1",
        chat_id,
    )
