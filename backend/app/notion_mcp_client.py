"""
Notion MCP client (Streamable HTTP transport, MCP 2025-11-25).

Each public coroutine opens a fresh httpx session, runs MCP initialize
to obtain a session ID, then issues the tool call before closing.
"""

import json
import logging
from datetime import datetime, timezone

import httpx

logger = logging.getLogger(__name__)

_MCP_URL = "https://mcp.notion.com/mcp"
_PROTOCOL = "2025-11-25"
_BASE_HEADERS: dict[str, str] = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "MCP-Protocol-Version": _PROTOCOL,
}


class NotionMCPError(Exception):
    pass


# ── SSE / JSON response parser ────────────────────────────────────────────────

def _parse(response: httpx.Response, req_id: int) -> dict:
    ct = response.headers.get("content-type", "")
    if "text/event-stream" in ct:
        for line in response.text.splitlines():
            if not line.startswith("data: "):
                continue
            try:
                msg = json.loads(line[6:])
            except json.JSONDecodeError:
                continue
            if msg.get("id") != req_id:
                continue
            if "result" in msg:
                return msg["result"]
            if "error" in msg:
                raise NotionMCPError(str(msg["error"]))
        raise NotionMCPError("No matching result in SSE stream")
    else:
        msg = response.json()
        if "result" in msg:
            return msg["result"]
        if "error" in msg:
            raise NotionMCPError(str(msg["error"]))
        raise NotionMCPError(f"Unexpected MCP response: {msg}")


def _extract_tool_content(result: dict) -> dict:
    """Parse the JSON text payload from a tools/call result."""
    for item in result.get("content", []):
        if item.get("type") == "text":
            try:
                return json.loads(item["text"])
            except (json.JSONDecodeError, KeyError):
                return {"text": item.get("text", "")}
    return {}


# ── Session helper ────────────────────────────────────────────────────────────

async def _open_session(client: httpx.AsyncClient, access_token: str) -> str | None:
    """Send MCP initialize; returns Mcp-Session-Id header value if present."""
    resp = await client.post(
        _MCP_URL,
        headers={**_BASE_HEADERS, "Authorization": f"Bearer {access_token}"},
        json={
            "jsonrpc": "2.0",
            "id": 0,
            "method": "initialize",
            "params": {
                "protocolVersion": _PROTOCOL,
                "capabilities": {},
                "clientInfo": {"name": "WarehouseDashboard", "version": "1.0.0"},
            },
        },
    )
    return resp.headers.get("Mcp-Session-Id")


async def _tool_call(
    client: httpx.AsyncClient,
    access_token: str,
    session_id: str | None,
    tool_name: str,
    arguments: dict,
) -> dict:
    headers = {**_BASE_HEADERS, "Authorization": f"Bearer {access_token}"}
    if session_id:
        headers["Mcp-Session-Id"] = session_id

    resp = await client.post(
        _MCP_URL,
        headers=headers,
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": arguments},
        },
    )
    resp.raise_for_status()
    return _parse(resp, 1)


async def _list_tools_raw(
    client: httpx.AsyncClient,
    access_token: str,
    session_id: str | None,
) -> list[dict]:
    headers = {**_BASE_HEADERS, "Authorization": f"Bearer {access_token}"}
    if session_id:
        headers["Mcp-Session-Id"] = session_id

    resp = await client.post(
        _MCP_URL,
        headers=headers,
        json={
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list",
            "params": {},
        },
    )
    resp.raise_for_status()
    result = _parse(resp, 2)
    return result.get("tools", [])


# ── Public API ────────────────────────────────────────────────────────────────

async def list_tools(access_token: str) -> list[dict]:
    """Return the list of tools exposed by the Notion MCP server."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        sid = await _open_session(client, access_token)
        return await _list_tools_raw(client, access_token, sid)


async def search_pages(access_token: str, query: str = "") -> list[dict]:
    """
    Search for Notion pages visible to the integration.
    Returns a simplified list: [{id, title, url}].
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        sid = await _open_session(client, access_token)

        # Discover available tools and find a search one
        tools = await _list_tools_raw(client, access_token, sid)
        tool_names = [t["name"] for t in tools]
        logger.info("Notion MCP tools: %s", tool_names)

        search_tool = next(
            (n for n in tool_names if "search" in n.lower()),
            None,
        )
        if not search_tool:
            raise NotionMCPError("No search tool found in Notion MCP")

        result = await _tool_call(
            client, access_token, sid, search_tool,
            {"query": query, "filter": {"value": "page", "property": "object"}},
        )

    data = _extract_tool_content(result)
    pages = []
    for obj in data.get("results", []):
        if obj.get("object") != "page":
            continue
        title_parts = (
            obj.get("properties", {})
               .get("title", {})
               .get("title", [])
        )
        title = "".join(p.get("plain_text", "") for p in title_parts) or "Untitled"
        pages.append({"id": obj["id"], "title": title, "url": obj.get("url", "")})
    return pages


async def create_execution_report(
    access_token: str,
    parent_page_id: str,
    plan: dict,
    explanation: str,
    task_ids: list[int],
) -> str:
    """
    Create a Notion page documenting the AI execution.
    Returns the URL of the newly created page (or "" on failure).
    """
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    task_type = plan.get("task_type", "").upper()
    item_name = plan.get("item_name", "Unknown")
    title = f"[AI] {task_type} — {item_name}  ·  {ts}"

    makespan_s = plan.get("makespan_s", 0)
    makespan_str = f"{makespan_s // 60}m {makespan_s % 60}s"

    def bullet(text: str) -> dict:
        return {
            "object": "block",
            "type": "bulleted_list_item",
            "bulleted_list_item": {
                "rich_text": [{"type": "text", "text": {"content": text}}]
            },
        }

    def h2(text: str) -> dict:
        return {
            "object": "block",
            "type": "heading_2",
            "heading_2": {"rich_text": [{"type": "text", "text": {"content": text}}]},
        }

    def divider() -> dict:
        return {"object": "block", "type": "divider", "divider": {}}

    children: list[dict] = [
        # AI explanation callout
        {
            "object": "block",
            "type": "callout",
            "callout": {
                "rich_text": [{"type": "text", "text": {
                    "content": explanation or "No explanation provided."
                }}],
                "icon": {"type": "emoji", "emoji": "🤖"},
                "color": "blue_background",
            },
        },
        divider(),
        h2("Summary"),
        bullet(f"Task type: {task_type}"),
        bullet(f"Item: {item_name}  (ID {plan.get('item_id')})"),
        bullet(f"Quantity: {plan.get('quantity_planned')} units"
               + (f"  ⚠ only {plan.get('quantity_available')} in stock"
                  if plan.get("insufficient_stock") else "")),
        bullet(f"Route: {plan.get('origin_zone')} → {plan.get('destination_zone')}"),
        bullet(f"Total trips: {plan.get('total_trips')}  across {plan.get('total_forklifts_used')} forklifts"),
        bullet(f"Est. completion: {makespan_str}"),
        divider(),
        h2("Forklift Assignments"),
    ]

    for a in plan.get("assignments", []):
        children.append(bullet(
            f"{a['forklift_name']}  —  {a['trips']} trip(s), "
            f"{a['units_assigned']} units, est. {a['estimated_seconds']}s"
        ))

    if task_ids:
        children += [
            divider(),
            h2("Created Task IDs"),
            {
                "object": "block",
                "type": "paragraph",
                "paragraph": {
                    "rich_text": [{"type": "text", "text": {
                        "content": ", ".join(str(t) for t in task_ids)
                    }}]
                },
            },
        ]

    create_args = {
        "parent": {"type": "page_id", "page_id": parent_page_id},
        "properties": {
            "title": {"title": [{"text": {"content": title}}]}
        },
        "children": children,
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        sid = await _open_session(client, access_token)

        # Discover the page-creation tool name
        tools = await _list_tools_raw(client, access_token, sid)
        tool_names = [t["name"] for t in tools]

        create_tool = next(
            (n for n in tool_names if "create" in n.lower() and "page" in n.lower()),
            None,
        )
        if not create_tool:
            # Fallback to known name
            create_tool = "notion_create_a_page"
        logger.info("Using Notion create-page tool: %s", create_tool)

        result = await _tool_call(client, access_token, sid, create_tool, create_args)

    page_data = _extract_tool_content(result)
    url = page_data.get("url", "")
    logger.info("Notion execution report created: %s", url)
    return url
