"""
DeepEval suite for the AI workflow planning agent (app/routers/ai_workflow.py).

Covers both:
  - deterministic assertions on the hard requirements written into _SYSTEM
    (must ground item_id in a real search_inventory result, must check
    forklift availability before planning, must not fabricate stock)
  - an LLM-judged check (GEval) on the quality of the operator-facing
    explanation text

Run: cd backend && deepeval test run tests/eval/test_ai_workflow.py
"""

import pytest
from deepeval import assert_test
from deepeval.metrics import GEval
from deepeval.test_case import LLMTestCase, LLMTestCaseParams

import app.routers.ai_workflow as aw
from tests.eval.conftest import claude_judge, requires_live_services


def _explanation_quality_metric() -> GEval:
    # Built lazily (inside a test, not at import time) — see claude_judge().
    return GEval(
        name="Operator Explanation Quality",
        criteria=(
            "The 'actual_output' is a message written for a warehouse operator explaining "
            "an execution plan given in 'context'. It should be concise (2-3 sentences), "
            "correctly state the item, quantity, and origin/destination zones drawn from "
            "'context', and must not invent details (items, quantities, zones) that are "
            "not present in 'context'."
        ),
        evaluation_params=[LLMTestCaseParams.INPUT, LLMTestCaseParams.ACTUAL_OUTPUT, LLMTestCaseParams.CONTEXT],
        threshold=0.7,
        model=claude_judge(),
    )


@requires_live_services
async def test_outbound_plan_is_grounded_in_real_inventory(conn):
    message = "outbound 20 units of safety gloves"
    result = await aw._run_agent(message, conn)
    plan = result["plan"]

    assert plan is not None, "agent failed to produce a plan for a well-formed request"
    assert plan["ok"] is True
    assert plan["task_type"] == "outbound"
    assert plan["destination_zone"] == "SHIP"

    # The plan must reflect real DB state, never a value Claude invented.
    row = await conn.fetchrow(
        "SELECT id, location_zone FROM inventory WHERE item_name ILIKE '%safety gloves%'"
    )
    assert row is not None, "fixture assumption broken — reseed the DB with seed.sql"
    assert plan["item_id"] == row["id"]
    assert plan["origin_zone"] == row["location_zone"]

    # Plan math: units assigned across forklifts must sum to what was planned,
    # and never exceed what was actually requested.
    assigned_total = sum(a["units_assigned"] for a in plan["assignments"])
    assert assigned_total == plan["quantity_planned"]
    assert plan["quantity_planned"] <= plan["quantity_requested"]

    assert_test(
        LLMTestCase(input=message, actual_output=result["explanation"], context=[str(plan)]),
        [_explanation_quality_metric()],
    )


@requires_live_services
async def test_nonexistent_item_does_not_fabricate_a_plan(conn):
    """Hard requirement: never invent an item_id that didn't come from search_inventory."""
    message = "outbound 5 units of gadget-thingy-that-does-not-exist-9182"
    result = await aw._run_agent(message, conn)
    assert result["plan"] is None, "agent must not fabricate a plan for an item that isn't in inventory"


@requires_live_services
async def test_tool_call_ordering_matches_hard_requirements(conn, monkeypatch):
    """
    Hard requirements in _SYSTEM: search_inventory and get_available_forklifts
    must each run at least once before create_execution_plan for a given
    request. We spy on the three tool-backing functions to record call
    order and assert the invariant directly, rather than trusting prompt
    wording alone.
    """
    call_log: list[str] = []

    orig_search = aw._tool_search_inventory
    orig_forklifts = aw._tool_get_forklifts
    orig_compute = aw._compute_plan

    async def spy_search(*a, **kw):
        call_log.append("search_inventory")
        return await orig_search(*a, **kw)

    async def spy_forklifts(*a, **kw):
        call_log.append("get_available_forklifts")
        return await orig_forklifts(*a, **kw)

    def spy_compute(*a, **kw):
        call_log.append("create_execution_plan")
        return orig_compute(*a, **kw)

    monkeypatch.setattr(aw, "_tool_search_inventory", spy_search)
    monkeypatch.setattr(aw, "_tool_get_forklifts", spy_forklifts)
    monkeypatch.setattr(aw, "_compute_plan", spy_compute)

    await aw._run_agent("outbound 15 units of safety gloves", conn)

    assert "create_execution_plan" in call_log, "expected a plan for a well-formed request"
    plan_idx = call_log.index("create_execution_plan")
    assert "search_inventory" in call_log[:plan_idx], "search_inventory must run before create_execution_plan"
    assert "get_available_forklifts" in call_log[:plan_idx], "get_available_forklifts must run before create_execution_plan"


@requires_live_services
async def test_insufficient_stock_is_reported_not_fabricated(conn):
    """Hard requirement: plan for available quantity, never a larger fabricated one."""
    row = await conn.fetchrow(
        "SELECT id, item_name, quantity, location_zone FROM inventory WHERE item_name ILIKE '%forklift battery%'"
    )
    assert row is not None, "fixture assumption broken — reseed the DB with seed.sql"

    requested = row["quantity"] + 500  # deliberately more than in stock
    message = f"outbound {requested} units of {row['item_name']}"
    result = await aw._run_agent(message, conn)
    plan = result["plan"]

    assert plan is not None
    assert plan["insufficient_stock"] is True
    assert plan["quantity_available"] == row["quantity"]
    assert plan["quantity_planned"] <= row["quantity"]


@requires_live_services
async def test_no_idle_forklifts_blocks_plan_creation(conn, monkeypatch):
    """Hard requirement: an empty forklift list must block create_execution_plan entirely."""

    async def no_forklifts(_conn):
        return []

    monkeypatch.setattr(aw, "_tool_get_forklifts", no_forklifts)

    result = await aw._run_agent("outbound 5 units of safety gloves", conn)
    assert result["plan"] is None, "must not create a plan when no forklifts are available"


@requires_live_services
async def test_replenishment_plan_grounded_in_real_inventory(conn):
    """
    Covers the 4th task type (replenishment), untested elsewhere in this file,
    and its distinct rule: quantity comes from bulk storage (STOR), so it is
    NOT capped by the item's current on-hand quantity like outbound/relocation are.
    """
    row = await conn.fetchrow(
        "SELECT id, item_name, location_zone FROM inventory WHERE item_name ILIKE '%forklift battery%'"
    )
    assert row is not None, "fixture assumption broken — reseed the DB with seed.sql"

    message = f"restock {row['item_name']} in zone {row['location_zone']}, add 20 units"
    result = await aw._run_agent(message, conn)
    plan = result["plan"]

    assert plan is not None, "agent failed to produce a plan for a well-formed replenishment request"
    assert plan["ok"] is True
    assert plan["task_type"] == "replenishment"
    assert plan["origin_zone"] == "STOR"
    assert plan["destination_zone"] == row["location_zone"]
    assert plan["quantity_planned"] == plan["quantity_requested"], (
        "replenishment quantity must not be capped by current on-hand stock"
    )


@requires_live_services
async def test_large_quantity_splits_across_multiple_forklifts(conn):
    """
    _compute_plan round-robins trips across idle forklifts closest-first —
    this is the first test that actually forces a multi-forklift split,
    rather than the single-forklift case every other test exercises.
    """
    forklifts = await conn.fetch("SELECT capacity FROM forklifts WHERE status = 'idle'")
    assert forklifts, "fixture assumption broken — need idle forklifts in the DB"
    max_capacity = max(r["capacity"] for r in forklifts)

    row = await conn.fetchrow(
        "SELECT id, item_name, quantity, location_zone FROM inventory WHERE item_name ILIKE '%industrial bolts%'"
    )
    assert row is not None, "fixture assumption broken — reseed the DB with seed.sql"

    requested = min(max_capacity + 50, row["quantity"])
    assert requested > max_capacity, (
        "fixture assumption broken — not enough stock to force a multi-forklift split"
    )

    message = f"outbound {requested} units of {row['item_name']}"
    result = await aw._run_agent(message, conn)
    plan = result["plan"]

    assert plan is not None
    assert plan["ok"] is True
    assert plan["total_forklifts_used"] > 1, (
        "a quantity exceeding any single forklift's capacity must be split across >1 forklift"
    )
    assigned_total = sum(a["units_assigned"] for a in plan["assignments"])
    assert assigned_total == plan["quantity_planned"]
    for a in plan["assignments"]:
        assert a["units_assigned"] <= a["capacity"] * a["trips"]
