"""
Gmail MCP Server — exposes Gmail read-only tools via the MCP stdio protocol.

Tools
-----
list_emails(sender, max_results=10)
    Returns [{id, subject, sender, date, snippet}] for recent emails from sender.

get_email(message_id)
    Returns {id, subject, sender, date, body} with plain-text body decoded.

Run directly:
    python gmail_mcp_server.py
    (stdio transport — invoked as a subprocess by mcp_gmail_client.py)

Required env var:
    GMAIL_CREDENTIALS_FILE  path to gmail_credentials.json (OAuth token file)
"""

import asyncio
import base64
import json
import os
import sys

import mcp.server.stdio
import mcp.types as types
from mcp.server import Server
from mcp.server.models import InitializationOptions, NotificationOptions

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

server = Server("gmail-warehouse")


# ── Google API helpers ────────────────────────────────────────────────────────

def _load_credentials_data() -> dict:
    """
    Load OAuth credential data from env var (EC2/prod) or file (local dev).

    Priority:
      1. GMAIL_CREDENTIALS_JSON — JSON string in env var (matches GOOGLE_OAUTH_JSON pattern)
      2. GMAIL_CREDENTIALS_FILE — path to a local JSON file (default: gmail_credentials.json)
    """
    raw = os.getenv("GMAIL_CREDENTIALS_JSON", "").strip()
    if raw:
        return json.loads(raw)

    creds_path = os.getenv("GMAIL_CREDENTIALS_FILE", "gmail_credentials.json")
    if not os.path.exists(creds_path):
        raise FileNotFoundError(
            f"Gmail credentials not found. "
            "Set GMAIL_CREDENTIALS_JSON (EC2) or GMAIL_CREDENTIALS_FILE (local). "
            "Run get_gmail_token.py to generate the credentials."
        )
    with open(creds_path) as f:
        return json.load(f)


def _get_service():
    data = _load_credentials_data()
    creds = Credentials(
        token=data.get("token"),
        refresh_token=data.get("refresh_token"),
        token_uri=data.get("token_uri", "https://oauth2.googleapis.com/token"),
        client_id=data.get("client_id"),
        client_secret=data.get("client_secret"),
        scopes=_SCOPES,
    )
    if not creds.valid and creds.refresh_token:
        creds.refresh(Request())
    return build("gmail", "v1", credentials=creds)


def _parse_headers(headers: list[dict]) -> dict[str, str]:
    return {h["name"].lower(): h["value"] for h in headers}


def _decode_body(payload: dict) -> str:
    """Recursively extract plain-text body from a Gmail message payload."""
    mime = payload.get("mimeType", "")
    if mime == "text/plain":
        raw = payload.get("body", {}).get("data", "")
        if raw:
            return base64.urlsafe_b64decode(raw + "==").decode("utf-8", errors="replace")
    elif mime.startswith("multipart/"):
        parts = "\n".join(_decode_body(p) for p in payload.get("parts", []))
        return parts
    return ""


# ── Tool definitions ──────────────────────────────────────────────────────────

@server.list_tools()
async def handle_list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name="list_emails",
            description=(
                "List recent emails from a specific sender address. "
                "Returns id, subject, sender, date, and snippet for each email."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "sender": {
                        "type": "string",
                        "description": "Sender email address to filter by",
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "Maximum number of emails to return (default 10, max 20)",
                        "default": 10,
                    },
                },
                "required": ["sender"],
            },
        ),
        types.Tool(
            name="get_email",
            description=(
                "Get the full plain-text content of an email by its Gmail message ID. "
                "Returns subject, sender, date, and decoded body text."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "message_id": {
                        "type": "string",
                        "description": "Gmail message ID (from list_emails)",
                    },
                },
                "required": ["message_id"],
            },
        ),
    ]


@server.call_tool()
async def handle_call_tool(
    name: str, arguments: dict
) -> list[types.TextContent | types.ImageContent | types.EmbeddedResource]:
    try:
        service = _get_service()
    except Exception as exc:
        return [types.TextContent(type="text", text=json.dumps({"error": str(exc)}))]

    if name == "list_emails":
        sender = arguments["sender"]
        max_results = min(int(arguments.get("max_results", 10)), 20)
        try:
            result = service.users().messages().list(
                userId="me",
                q=f"from:{sender}",
                maxResults=max_results,
            ).execute()
            messages = result.get("messages", [])
            output = []
            for msg in messages:
                meta = service.users().messages().get(
                    userId="me",
                    id=msg["id"],
                    format="metadata",
                    metadataHeaders=["Subject", "From", "Date"],
                ).execute()
                headers = _parse_headers(meta.get("payload", {}).get("headers", []))
                output.append({
                    "id": msg["id"],
                    "subject": headers.get("subject", "(no subject)"),
                    "sender": headers.get("from", sender),
                    "date": headers.get("date", ""),
                    "snippet": meta.get("snippet", ""),
                })
            return [types.TextContent(type="text", text=json.dumps(output, indent=2))]
        except Exception as exc:
            return [types.TextContent(type="text", text=json.dumps({"error": str(exc)}))]

    elif name == "get_email":
        message_id = arguments["message_id"]
        try:
            msg = service.users().messages().get(
                userId="me", id=message_id, format="full"
            ).execute()
            payload = msg.get("payload", {})
            headers = _parse_headers(payload.get("headers", []))
            body = _decode_body(payload).strip()
            return [types.TextContent(type="text", text=json.dumps({
                "id": message_id,
                "subject": headers.get("subject", "(no subject)"),
                "sender": headers.get("from", ""),
                "date": headers.get("date", ""),
                "body": body,
            }, indent=2))]
        except Exception as exc:
            return [types.TextContent(type="text", text=json.dumps({"error": str(exc)}))]

    return [types.TextContent(type="text", text=json.dumps({"error": f"Unknown tool: {name}"}))]


# ── Entry point ───────────────────────────────────────────────────────────────

async def main() -> None:
    async with mcp.server.stdio.stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            InitializationOptions(
                server_name="gmail-warehouse",
                server_version="0.1.0",
                capabilities=server.get_capabilities(
                    notification_options=NotificationOptions(),
                    experimental_capabilities={},
                ),
            ),
        )


if __name__ == "__main__":
    asyncio.run(main())
