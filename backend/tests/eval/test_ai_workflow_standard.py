"""
Canonical DeepEval dataset-driven evaluation for the AI workflow planning
agent, using the library's own primitives end to end instead of hand-rolled
pytest asserts:

  EvaluationDataset + Golden   — input scenarios, loaded from a JSON file
                                 (tests/eval/data/ai_workflow_goldens.json)
  ToolCall / tools_called      — what the agent actually did, captured live
                                 via _run_agent's optional `trace` argument
  ToolCorrectnessMetric        — did it call the right tools in the right
                                 order (should_consider_ordering=True)
  GEval                        — is the operator-facing explanation any good
  evaluate()                   — runs the whole dataset and prints
                                 DeepEval's standard report table

This complements, not replaces, test_ai_workflow.py: ToolCorrectnessMetric
can only check *which tools* were called and in what order, not whether the
agent's arguments were actually correct. The DB-grounding checks (is
item_id really the row search_inventory found), the plan arithmetic, the
"never fabricate a plan" and "never fabricate quantity_available" cases,
and the insufficient-stock regression all stay in test_ai_workflow.py as
plain deterministic asserts — that's the right tool for exact-value checks,
where a metric would just add indirection.

Run: cd backend && deepeval test run tests/eval/test_ai_workflow_standard.py
"""

from pathlib import Path

from deepeval import evaluate
from deepeval.dataset import EvaluationDataset
from deepeval.metrics import GEval, ToolCorrectnessMetric
from deepeval.test_case import LLMTestCase, LLMTestCaseParams, ToolCall

import app.routers.ai_workflow as aw
from tests.eval.conftest import claude_judge, requires_live_services

DATASET_FILE = Path(__file__).parent / "data" / "ai_workflow_goldens.json"


def _explanation_quality_metric() -> GEval:
    # Built lazily (inside a test, not at import time) — see claude_judge().
    return GEval(
        name="Operator Explanation Quality",
        criteria=(
            "The 'actual_output' is a message written for a warehouse operator "
            "explaining an execution plan for the request in 'input'. It should be "
            "concise (2-3 sentences) and specific to that request — not generic "
            "boilerplate."
        ),
        evaluation_params=[LLMTestCaseParams.INPUT, LLMTestCaseParams.ACTUAL_OUTPUT],
        threshold=0.7,
        model=claude_judge(),
    )


@requires_live_services
async def test_planning_agent_against_golden_dataset(conn):
    dataset = EvaluationDataset()
    dataset.add_goldens_from_json_file(
        str(DATASET_FILE),
        input_key_name="input",
        expected_tools_key_name="expected_tools",
    )
    assert dataset.goldens, f"no goldens loaded from {DATASET_FILE}"

    for golden in dataset.goldens:
        trace: list[dict] = []
        result = await aw._run_agent(golden.input, conn, trace=trace)
        tools_called = [ToolCall(name=t["name"], input_parameters=t["input"]) for t in trace]

        dataset.add_test_case(
            LLMTestCase(
                input=golden.input,
                actual_output=result["explanation"] or "(agent produced no explanation)",
                tools_called=tools_called,
                expected_tools=golden.expected_tools,
            )
        )

    eval_result = evaluate(
        test_cases=dataset.test_cases,
        metrics=[
            ToolCorrectnessMetric(should_consider_ordering=True),
            _explanation_quality_metric(),
        ],
    )

    failed = [r.name for r in eval_result.test_results if not r.success]
    assert not failed, f"golden dataset cases failed: {failed}"
