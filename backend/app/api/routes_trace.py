"""GET /v1/trace/stream — live request-lifecycle events via SSE over Redis pub/sub.

Each connection opens its own Redis pub/sub subscription to TRACE_CHANNEL, so
every connected client receives every event (fan-out — not competing consumers).
On client disconnect the subscription is closed and the connection released, so
Redis connections are not leaked. Optional ?request_id= filters to one request.
"""
from __future__ import annotations

import json
from collections.abc import AsyncGenerator

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app.core.redis_client import get_redis
from app.core.trace import TRACE_CHANNEL

router = APIRouter(prefix="/v1/trace", tags=["trace"])

_KEEPALIVE_SECONDS = 15


async def _event_stream(request: Request, request_id: str | None) -> AsyncGenerator[str]:
    pubsub = get_redis().pubsub()
    await pubsub.subscribe(TRACE_CHANNEL)
    try:
        # Announce the stream is open so clients get an immediate response.
        yield "event: open\ndata: {}\n\n"
        while True:
            if await request.is_disconnected():
                break
            message = await pubsub.get_message(
                ignore_subscribe_messages=True, timeout=_KEEPALIVE_SECONDS
            )
            if message is None:
                # keepalive comment so proxies/clients don't time out
                yield ": keepalive\n\n"
                continue
            data = message["data"]
            if request_id is not None:
                try:
                    if json.loads(data).get("request_id") != request_id:
                        continue
                except (json.JSONDecodeError, TypeError):
                    continue
            yield f"data: {data}\n\n"
    finally:
        await pubsub.unsubscribe(TRACE_CHANNEL)
        await pubsub.aclose()


@router.get("/stream")
async def trace_stream(request: Request, request_id: str | None = None) -> StreamingResponse:
    return StreamingResponse(
        _event_stream(request, request_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
