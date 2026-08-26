"""
DeepEval suite for the WhatsApp intent-extraction agent (app/routers/whatsapp.py).

Run: cd backend && deepeval test run tests/eval/test_whatsapp_intent.py
"""

from deepeval import assert_test
from deepeval.metrics import GEval
from deepeval.test_case import LLMTestCase, LLMTestCaseParams

from app.routers.whatsapp import _run_intent_agent
from tests.eval.conftest import claude_judge, requires_live_services


def _brevity_metric() -> GEval:
    # Built lazily (inside a test, not at import time) — see claude_judge().
    return GEval(
        name="WhatsApp Brevity",
        criteria=(
            "The 'actual_output' is a reply in a WhatsApp chat. It must be short — at "
            "most 2 sentences — and must never mention tools, functions, or internal "
            "processes to the user."
        ),
        evaluation_params=[LLMTestCaseParams.INPUT, LLMTestCaseParams.ACTUAL_OUTPUT],
        threshold=0.7,
        model=claude_judge(),
    )


@requires_live_services
async def test_complete_request_confirms_intent_immediately():
    messages = [{"role": "user", "content": "relocate 15 wire rope from A3 to B2"}]
    result = await _run_intent_agent(messages)
    intent = result["intent"]

    assert intent is not None, "agent should have called confirm_intent for a complete request"
    assert intent["task_type"] == "relocation"


@requires_live_services
async def test_reply_is_brief_and_hides_internals():
    messages = [{"role": "user", "content": "hey, can you move some pallets around for me?"}]
    result = await _run_intent_agent(messages)

    assert_test(
        LLMTestCase(input=messages[-1]["content"], actual_output=result["text"]),
        [_brevity_metric()],
    )


@requires_live_services
async def test_asks_clarifying_question_when_info_is_missing():
    """Mirrors telegram's equivalent case — untested for the WhatsApp agent until now."""
    messages = [{"role": "user", "content": "can you help me with something in the warehouse?"}]
    result = await _run_intent_agent(messages)

    assert result["intent"] is None, "should not call confirm_intent with missing task info"
    assert result["text"].strip() != "", "should ask a clarifying question instead"
