"""
MCP client for the Gmail warehouse integration.

Spawns gmail_mcp_server.py as a stdio subprocess, then runs a Claude agentic
loop that uses two MCP tools (list_emails, get_email) plus one inline tool
(confirm_order) to extract a structured outbound order from an email.

Public API
----------
list_emails(sender, max_results) → list[dict]
    Returns raw email metadata from Gmail via the MCP server.

extract_order_from_email(message_id) → {"order": {...}, "email": {...}}
    Claude reads the email via MCP and calls confirm_order with extracted data.
"""

import json
import logging
import os
import sys
from pathlib import Path
from typing import Any

import anthropic
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from app.observability import agent_span

logger = logging.getLogger(__name__)

_SERVER_SCRIPT = str(Path(__file__).parent / "gmail_mcp_server.py")

# ── Claude extraction prompt + inline tool ────────────────────────────────────

_EXTRACT_SYSTEM = """\
You are an order intake assistant for a warehouse management system.

When given an email message ID:
1. Call get_email to read its full content.
2. Identify the task type from the email:
   - "inbound"       — goods arriving into the warehouse (e.g. "receive", "inbound", "arriving")
   - "outbound"      — goods shipped out (e.g. "ship", "outbound", "dispatch", "send")
   - "relocation"    — move stock from one zone to another (e.g. "move", "relocate", "transfer")
   - "replenishment" — restock a zone from bulk storage (e.g. "restock", "replenish", "refill")
3. Extract item name, quantity, and zones as appropriate (see rules).
4. Call confirm_order with the structured result.

Zone rules:
- inbound:       origin_zone=DOCK,  destination_zone=item's storage zone (leave blank if unknown)
- outbound:      origin_zone=blank, destination_zone=SHIP
- relocation:    origin_zone=source zone stated in email, destination_zone=target zone stated in email
- replenishment: origin_zone=STOR,  destination_zone=zone to restock (leave blank if unknown)

General rules:
- Quantities must be positive integers; extract exactly what is stated.
- If no clear warehouse task is found, call confirm_order with is_order=false.
- Never guess quantities — if unclear, set is_order=false.
- Keep your notes brief and factual.\
"""

_CONFIRM_TOOL: dict[str, Any] = {
    "name": "confirm_order",
    "description": (
        "Call this once you have read the email and determined whether it contains "
        "a warehouse task. Always call this — even when no task is found."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "is_order": {
                "type": "boolean",
                "description": "True if a clear warehouse task was found",
            },
            "task_type": {
                "type": "string",
                "enum": ["inbound", "outbound", "relocation", "replenishment"],
                "description": "Type of warehouse task",
            },
            "item_name": {
                "type": "string",
                "description": "Exact item name (required when is_order=true)",
            },
            "quantity": {
                "type": "integer",
                "description": "Number of units (required when is_order=true)",
            },
            "origin_zone": {
                "type": "string",
                "description": "Source zone (DOCK for inbound, STOR for replenishment, explicit zone for relocation)",
            },
            "destination_zone": {
                "type": "string",
                "description": "Destination zone (SHIP for outbound, explicit zone for relocation/replenishment)",
            },
            "notes": {
                "type": "string",
                "description": "Any extra context from the email (urgency, contact, etc.)",
            },
        },
        "required": ["is_order"],
    },
}


def _server_params() -> StdioServerParameters:
    creds_file = os.getenv("GMAIL_CREDENTIALS_FILE", "gmail_credentials.json")
    return StdioServerParameters(
        command=sys.executable,
        args=[_SERVER_SCRIPT],
        env={**os.environ, "GMAIL_CREDENTIALS_FILE": creds_file},
    )


# ── Public helpers ────────────────────────────────────────────────────────────

async def list_emails(sender: str, max_results: int = 15) -> list[dict]:
    """Fetch recent email metadata from Gmail via the MCP server."""
    params = _server_params()
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool(
                "list_emails",
                {"sender": sender, "max_results": max_results},
            )
            text = result.content[0].text if result.content else "[]"
            data = json.loads(text)
            if isinstance(data, dict) and "error" in data:
                raise RuntimeError(data["error"])
            return data


async def extract_order_from_email(message_id: str) -> dict[str, Any]:
    """
    Use Claude (with Gmail MCP tools) to read an email and extract order info.

    Returns {"order": <confirm_order input>, "email": <get_email result>}.
    "order" is None if Claude found no valid order.
    """
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not configured on the server.")

    client = anthropic.AsyncAnthropic(api_key=api_key)
    params = _server_params()

    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            # Discover MCP tools from the server
            mcp_tools_result = await session.list_tools()
            mcp_tools: list[dict[str, Any]] = [
                {
                    "name": t.name,
                    "description": t.description or "",
                    "input_schema": t.inputSchema,
                }
                for t in mcp_tools_result.tools
            ]
            mcp_tool_names = {t["name"] for t in mcp_tools}

            # All tools: MCP (list_emails, get_email) + inline confirm_order
            all_tools = mcp_tools + [_CONFIRM_TOOL]

            messages: list[dict[str, Any]] = [
                {
                    "role": "user",
                    "content": (
                        f"Please read email with ID '{message_id}' and extract any warehouse order (inbound or outbound)."
                    ),
                }
            ]

            order_data: dict | None = None
            email_data: dict | None = None

            with agent_span("gmail.extract_order", **{"input.value": message_id}):
                for _ in range(10):  # hard cap on tool rounds
                    response = await client.messages.create(
                        model="claude-sonnet-4-6",
                        max_tokens=1024,
                        system=_EXTRACT_SYSTEM,
                        tools=all_tools,
                        messages=messages,
                    )

                    if response.stop_reason in ("end_turn", None):
                        break
                    if response.stop_reason != "tool_use":
                        break

                    tool_results: list[dict[str, Any]] = []

                    for block in response.content:
                        if block.type != "tool_use":
                            continue

                        if block.name == "confirm_order":
                            # Inline tool — capture the structured output
                            order_data = dict(block.input)
                            tool_results.append({
                                "type": "tool_result",
                                "tool_use_id": block.id,
                                "content": "Order recorded.",
                            })

                        elif block.name in mcp_tool_names:
                            # MCP tool — delegate to the running server subprocess
                            try:
                                mcp_result = await session.call_tool(
                                    block.name, dict(block.input)
                                )
                                result_text = (
                                    mcp_result.content[0].text
                                    if mcp_result.content
                                    else "{}"
                                )
                            except Exception as exc:
                                result_text = json.dumps({"error": str(exc)})

                            # Capture the email body for storage
                            if block.name == "get_email":
                                try:
                                    email_data = json.loads(result_text)
                                except Exception:
                                    pass

                            tool_results.append({
                                "type": "tool_result",
                                "tool_use_id": block.id,
                                "content": result_text,
                            })

                        else:
                            tool_results.append({
                                "type": "tool_result",
                                "tool_use_id": block.id,
                                "content": json.dumps({"error": f"Unknown tool: {block.name}"}),
                            })

                    messages.append({"role": "assistant", "content": response.content})
                    messages.append({"role": "user", "content": tool_results})

                    if order_data is not None:
                        break

    return {"order": order_data, "email": email_data}
