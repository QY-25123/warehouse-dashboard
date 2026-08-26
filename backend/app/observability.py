"""
OpenTelemetry tracing for every Claude API call in the app, exported to
Arize Phoenix.

Instrumentation is automatic: `AnthropicInstrumentor` patches the
`anthropic` SDK once at process startup, so every `client.messages.create()`
call across ai_workflow.py, mcp_gmail_client.py, telegram_bot.py, and
whatsapp.py is captured (prompt, tool calls, response, latency, token
usage) with zero changes at each call site.

`agent_span()` wraps each of those four top-level agent entry points so
Phoenix groups the underlying Claude calls under a named workflow trace
instead of four indistinguishable "AsyncAnthropic" spans.
"""

import logging
import os
from contextlib import contextmanager
from typing import Iterator

logger = logging.getLogger(__name__)

_instrumented = False
_tracer = None


def init_observability() -> None:
    """Wire up OTel export to Phoenix. No-op if PHOENIX_COLLECTOR_ENDPOINT is unset."""
    global _instrumented, _tracer

    if _instrumented:
        return

    endpoint = os.getenv("PHOENIX_COLLECTOR_ENDPOINT", "").strip()
    if not endpoint:
        logger.info("PHOENIX_COLLECTOR_ENDPOINT not set — Phoenix tracing disabled.")
        return

    from phoenix.otel import register
    from openinference.instrumentation.anthropic import AnthropicInstrumentor

    # Deliberately do NOT pass endpoint=/api_key= here — phoenix.otel reads
    # PHOENIX_COLLECTOR_ENDPOINT / PHOENIX_API_KEY from the environment
    # itself, and for an app.phoenix.arize.com host it uses that to build
    # the correct Phoenix Cloud path (/s/<space>/v1/traces). Passing
    # endpoint= explicitly bypasses that entirely and posts straight to the
    # bare space URL, which 405s.
    tracer_provider = register(
        project_name=os.getenv("PHOENIX_PROJECT_NAME", "warehouse-dashboard"),
        batch=True,
    )
    AnthropicInstrumentor().instrument(tracer_provider=tracer_provider)
    _tracer = tracer_provider.get_tracer("warehouse-dashboard.agents")
    _instrumented = True
    logger.info("Phoenix tracing enabled -> %s", endpoint)


@contextmanager
def agent_span(workflow: str, **attributes) -> Iterator[None]:
    """Tag the Claude calls made inside the block as belonging to `workflow`."""
    if _tracer is None:
        yield
        return

    with _tracer.start_as_current_span(workflow) as span:
        for key, value in attributes.items():
            if value is not None:
                span.set_attribute(key, value)
        yield
