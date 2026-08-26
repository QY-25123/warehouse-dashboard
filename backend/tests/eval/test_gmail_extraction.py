"""
DeepEval suite for the Gmail order-extraction agent (app/mcp_gmail_client.py).

extract_order_from_email() spawns a real Gmail MCP subprocess over stdio,
which we can't run in CI without live Gmail credentials. So here we fake
just the MCP transport (stdio_client / ClientSession) with a canned
get_email response and let Claude do the actual extraction for real —
that's the part we're evaluating.

Run: cd backend && deepeval test run tests/eval/test_gmail_extraction.py
"""

import json
from contextlib import asynccontextmanager
from types import SimpleNamespace

import app.mcp_gmail_client as gmail_client
from tests.eval.conftest import requires_live_services


def _fake_transport(email: dict):
    """Build stand-ins for stdio_client/ClientSession that serve one canned email."""

    @asynccontextmanager
    async def fake_stdio_client(_params):
        yield (None, None)

    class FakeSession:
        def __init__(self, *_a, **_kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_exc):
            return False

        async def initialize(self):
            pass

        async def list_tools(self):
            tool = SimpleNamespace(
                name="get_email",
                description="Fetch a single email by message ID.",
                inputSchema={
                    "type": "object",
                    "properties": {"message_id": {"type": "string"}},
                    "required": ["message_id"],
                },
            )
            return SimpleNamespace(tools=[tool])

        async def call_tool(self, name, _args):
            assert name == "get_email"
            return SimpleNamespace(content=[SimpleNamespace(text=json.dumps(email))])

    return fake_stdio_client, FakeSession


async def _extract(monkeypatch, email: dict) -> dict:
    fake_stdio_client, FakeSession = _fake_transport(email)
    monkeypatch.setattr(gmail_client, "stdio_client", fake_stdio_client)
    monkeypatch.setattr(gmail_client, "ClientSession", FakeSession)
    return await gmail_client.extract_order_from_email("fake-message-id")


@requires_live_services
async def test_extracts_outbound_order_from_email_body(monkeypatch):
    email = {
        "id": "fake-message-id",
        "subject": "Shipment request",
        "sender": "warehouse-manager@example.com",
        "body": "Please ship out 25 units of Cable Ties 100pk today.",
    }
    result = await _extract(monkeypatch, email)
    order = result["order"]

    assert order is not None, "confirm_order should have been called"
    assert order["is_order"] is True
    assert order["task_type"] == "outbound"
    assert order["quantity"] == 25
    assert "cable ties" in order["item_name"].lower()
    assert order["destination_zone"] == "SHIP"


@requires_live_services
async def test_email_with_no_task_sets_is_order_false(monkeypatch):
    email = {
        "id": "fake-message-id",
        "subject": "Happy holidays",
        "sender": "manager@example.com",
        "body": "Just wanted to wish the team a great weekend, no action needed.",
    }
    result = await _extract(monkeypatch, email)
    order = result["order"]

    assert order is not None, "confirm_order must always be called, even with no task"
    assert order["is_order"] is False


@requires_live_services
async def test_vague_quantity_does_not_get_guessed(monkeypatch):
    """Hard requirement: never guess quantities — set is_order=false if unclear."""
    email = {
        "id": "fake-message-id",
        "subject": "Restock",
        "sender": "manager@example.com",
        "body": "We're running low on hydraulic oil, can you send some over soon?",
    }
    result = await _extract(monkeypatch, email)
    order = result["order"]

    assert order is not None
    assert order["is_order"] is False, "quantity is unspecified — must not fabricate one"
