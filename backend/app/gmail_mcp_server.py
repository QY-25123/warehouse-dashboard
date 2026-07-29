"""
Gmail MCP Server — exposes Gmail read-only tools via the MCP stdio protocol.

Tools
-----
list_emails(sender, max_results=10)
    Returns a JSON string: [{id, subject, sender, date, snippet}, ...]

get_email(message_id)
    Returns a JSON string: {id, subject, sender, date, body}

Run directly:
    python gmail_mcp_server.py
    (stdio transport — invoked as a subprocess by mcp_gmail_client.py)

Required env var:
    GMAIL_CREDENTIALS_JSON  full OAuth token JSON as a string (EC2/prod)
    GMAIL_CREDENTIALS_FILE  path to gmail_credentials.json (local dev fallback)
"""

import base64
import json
import os
import re

from mcp.server.fastmcp import FastMCP

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

mcp = FastMCP("gmail-warehouse")


# ── Google API helpers ────────────────────────────────────────────────────────

def _load_credentials_data() -> dict:
    raw = os.getenv("GMAIL_CREDENTIALS_JSON", "").strip()
    if raw:
        return json.loads(raw)

    creds_path = os.getenv("GMAIL_CREDENTIALS_FILE", "gmail_credentials.json")
    if not os.path.exists(creds_path):
        raise FileNotFoundError(
            "Gmail credentials not found. "
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
    mime = payload.get("mimeType", "")
    if mime == "text/plain":
        raw = payload.get("body", {}).get("data", "")
        if raw:
            return base64.urlsafe_b64decode(raw + "==").decode("utf-8", errors="replace")
    elif mime == "text/html":
        raw = payload.get("body", {}).get("data", "")
        if raw:
            html = base64.urlsafe_b64decode(raw + "==").decode("utf-8", errors="replace")
            return re.sub(r"<[^>]+>", " ", html).strip()
    elif mime.startswith("multipart/"):
        parts = payload.get("parts", [])
        # Prefer plain text; fall back to HTML
        plain = next((p for p in parts if p.get("mimeType") == "text/plain"), None)
        if plain:
            return _decode_body(plain)
        return "\n".join(_decode_body(p) for p in parts)
    return ""


# ── Tools ─────────────────────────────────────────────────────────────────────

@mcp.tool()
def list_emails(sender: str, max_results: int = 10) -> str:
    """
    List recent emails from a specific sender address.

    Returns a JSON array of {id, subject, sender, date, snippet}.
    """
    try:
        service = _get_service()
        max_results = min(max_results, 20)
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
        return json.dumps(output, indent=2)
    except Exception as exc:
        return json.dumps({"error": str(exc)})


@mcp.tool()
def get_email(message_id: str) -> str:
    """
    Get the full plain-text content of an email by its Gmail message ID.

    Returns a JSON object with {id, subject, sender, date, body}.
    """
    try:
        service = _get_service()
        msg = service.users().messages().get(
            userId="me", id=message_id, format="full"
        ).execute()
        payload = msg.get("payload", {})
        headers = _parse_headers(payload.get("headers", []))
        body = _decode_body(payload).strip()
        return json.dumps({
            "id": message_id,
            "subject": headers.get("subject", "(no subject)"),
            "sender": headers.get("from", ""),
            "date": headers.get("date", ""),
            "body": body,
        }, indent=2)
    except Exception as exc:
        return json.dumps({"error": str(exc)})


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    mcp.run()
