"""
Shared fixtures for the DeepEval agent-behavior suite.

These are live-agent evals, not mocked unit tests: they call the real
Claude API (except test_gmail_extraction.py, which fakes the Gmail MCP
transport but still calls Claude for the extraction itself) against a
real Postgres database. They need:

  - ANTHROPIC_API_KEY set
  - DATABASE_URL (or POSTGRES_HOST/PORT/DB/USER/PASSWORD) pointing at a
    database seeded with seed.sql — several tests assume seed.sql's
    inventory rows exist (e.g. "Safety Gloves L" in zone A1, qty 120)

Run with:
    cd backend && deepeval test run tests/eval
"""

import os

import pytest
import pytest_asyncio

from app.database import create_pool

requires_live_services = pytest.mark.skipif(
    not os.getenv("ANTHROPIC_API_KEY"),
    reason="ANTHROPIC_API_KEY not set — these tests call the real Claude API.",
)


def claude_judge():
    """
    LLM-judge model for GEval metrics, using Claude instead of DeepEval's
    OpenAI default (this project has no OPENAI_API_KEY). Build lazily,
    inside a test body — never at module import time — so collection
    doesn't fail before the ANTHROPIC_API_KEY skip check has a chance to run.
    """
    from deepeval.models import AnthropicModel

    return AnthropicModel(model="claude-sonnet-4-6")


@pytest_asyncio.fixture
async def pool():
    p = await create_pool()
    yield p
    await p.close()


@pytest_asyncio.fixture
async def conn(pool):
    async with pool.acquire() as c:
        yield c
