# Agent evals (DeepEval)

Live-agent tests for the four Claude call sites: the planning agent
(`ai_workflow.py`), Gmail order extraction (`mcp_gmail_client.py`), and the
Telegram/WhatsApp intent agents. Each file mixes deterministic asserts
(tool-call ordering, plan math, grounding in real DB rows) with a couple of
`GEval` LLM-judged checks (explanation quality, WhatsApp brevity).

## Setup

```bash
cd backend
pip install -r requirements-dev.txt
```

Needs in the environment (`backend/.env` is picked up automatically):

- `ANTHROPIC_API_KEY` — tests call the real Claude API and cost real tokens
- `DATABASE_URL` (or `POSTGRES_*`) pointing at a DB seeded with `seed.sql` —
  the ai_workflow tests assume seed data like "Safety Gloves L" (zone A1)
  and "Forklift Battery 48V" (low stock) exist

Tests are skipped automatically (not failed) if `ANTHROPIC_API_KEY` is unset.

## Run

```bash
deepeval test run tests/eval          # all four suites
deepeval test run tests/eval/test_ai_workflow.py   # one suite
```

`deepeval test run` is a thin wrapper around `pytest` — plain `pytest tests/eval`
also works.

## Notes

- `test_gmail_extraction.py` fakes the MCP stdio transport (no real Gmail
  subprocess/credentials needed) but still calls Claude for real, since
  that's what's under test.
- These are integration-style evals, not unit tests — expect each run to
  take a while and to cost API credits. Not currently wired into CI; run
  them manually before changing a system prompt or tool schema in any of
  the four files.
