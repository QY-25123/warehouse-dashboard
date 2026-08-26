"""
DeepEval suite for the Telegram intent-extraction agent (app/routers/telegram_bot.py).

Pure function under test — no DB or network beyond the Claude API call.

Run: cd backend && deepeval test run tests/eval/test_telegram_intent.py
"""

from app.routers.telegram_bot import _run_intent_agent
from tests.eval.conftest import requires_live_services


@requires_live_services
async def test_extracts_outbound_intent_without_asking_for_implied_zones():
    # The real call site (telegram_bot.py:408) always passes the live inventory
    # list — without it the agent has no way to know which zone "steel brackets"
    # currently sits in, and reasonably asks. Match production usage here.
    inventory = [{"item_name": "Steel Brackets 10cm", "location_zone": "A1", "quantity": 200}]
    messages = [{"role": "user", "content": "outbound 30 units of steel brackets"}]
    result = await _run_intent_agent(messages, inventory=inventory)
    intent = result["intent"]

    assert intent is not None, "agent should have called confirm_intent for a complete request"
    assert intent["task_type"] == "outbound"
    # Rule: never ask for zones the task type already implies (outbound -> SHIP).
    assert "zone" not in result["text"].lower()


@requires_live_services
async def test_resolves_numbered_item_from_inventory_list():
    inventory = [
        {"item_name": "Safety Gloves L", "location_zone": "A1", "quantity": 120},
        {"item_name": "Hydraulic Oil 5L", "location_zone": "A2", "quantity": 30},
    ]
    messages = [{"role": "user", "content": "inbound 40 units of item 2"}]
    result = await _run_intent_agent(messages, inventory=inventory)
    intent = result["intent"]

    assert intent is not None
    # Must resolve "item 2" to its real name itself, never ask the manager to clarify.
    item_query = str(intent.get("item_query") or intent.get("items") or "").lower()
    assert "hydraulic" in item_query or "oil" in item_query


@requires_live_services
async def test_asks_one_clarifying_question_when_info_is_missing():
    messages = [{"role": "user", "content": "I need some boxes moved around"}]
    result = await _run_intent_agent(messages)

    assert result["intent"] is None, "should not call confirm_intent with missing task info"
    assert result["text"].strip() != "", "should ask a clarifying question instead"


@requires_live_services
async def test_multi_item_request_uses_items_array():
    """
    Rule 2 in _INTENT_SYSTEM: multiple items in one message must use the
    `items` array, not be split into a single item_query — untested by the
    other cases here, which are all single-item.
    """
    inventory = [
        {"item_name": "Safety Gloves L", "location_zone": "A1", "quantity": 120},
        {"item_name": "Hydraulic Oil 5L", "location_zone": "A2", "quantity": 30},
    ]
    messages = [{"role": "user", "content": "inbound 50 units each for item 1 and item 2"}]
    result = await _run_intent_agent(messages, inventory=inventory)
    intent = result["intent"]

    assert intent is not None, "agent should have called confirm_intent for a complete request"
    assert intent["task_type"] == "inbound"
    items = intent.get("items")
    assert items is not None and len(items) == 2, (
        "multiple items in one request must use the items array, not a single item_query"
    )
    resolved = " ".join(str(i.get("item_query", "")).lower() for i in items)
    assert "glove" in resolved or "safety" in resolved
    assert "hydraulic" in resolved or "oil" in resolved
