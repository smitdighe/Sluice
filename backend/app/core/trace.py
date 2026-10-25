"""Lightweight trace event bus over Redis pub/sub.

Redis is already the shared bus for rate-limiter/circuit-breaker state, so it is
the natural fan-out channel for live request-lifecycle events too. Publishing is
fire-and-forget: `publish_event` schedules the publish on the event loop and never
raises into the caller, so the /v1/chat hot path is never blocked or failed by a
tracing hiccup. SSE subscribers (routes_trace) each open their own pub/sub
subscription, so every subscriber receives every event (true fan-out).
"""
from __future__ import annotations

import asyncio
import json
import logging

from app.core.redis_client import get_redis

logger = logging.getLogger("sluice.trace")

TRACE_CHANNEL = "sluice:trace"

# Strong refs to in-flight publish tasks. Without this, asyncio only holds a weak
# reference to a bare create_task() result, so a pending fire-and-forget publish
# can be garbage-collected before it runs — silently dropping trace events.
_pending: set = set()


async def _publish(event: dict) -> None:
    try:
        await get_redis().publish(TRACE_CHANNEL, json.dumps(event))
    except Exception as exc:  # noqa: BLE001 — tracing must never break the hot path
        logger.debug("trace publish dropped: %s", exc)


def publish_event(event: dict) -> None:
    """Fire-and-forget publish. Returns immediately; does not await the round-trip."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        # No running loop (shouldn't happen in request path) — skip silently.
        return
    task = loop.create_task(_publish(event))
    _pending.add(task)
    task.add_done_callback(_pending.discard)
