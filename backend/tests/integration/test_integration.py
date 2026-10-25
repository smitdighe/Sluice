"""Phase 7 integration + concurrency pass.

These run against the live docker-compose Postgres + Redis (+ a reachable cloud
provider for the one full-lifecycle test). They assert real behavior across
module boundaries, not just HTTP 200s.
"""
from __future__ import annotations

import asyncio
import json
import time
import uuid

import pytest
from sqlalchemy import text

from app.config import settings
from app.core.cache import semantic_cache
from app.core.redis_client import get_redis
from app.core.resilience import circuit_breaker as cb
from app.core.resilience import rate_limiter as rl
from app.core.resilience.retry import call_with_retry
from app.core.router import policy
from app.core.router.selector import select_provider
from app.core.trace import TRACE_CHANNEL
from app.db.session import async_session_maker
from app.models.db_models import Classification
from app.providers import registry
from app.providers.base import ProviderAdapter, ProviderError


async def _reset(provider_list=("groq", "cerebras", "gemini")):
    for p in provider_list:
        await rl.reset(p)
        await cb.reset(p)


async def _clear_cache():
    async with async_session_maker() as s:
        await s.execute(text("DELETE FROM cache_entries"))
        await s.commit()


# ---- Constraint check: chaos inert when disabled -------------------------
async def test_chaos_inert_when_disabled():
    assert settings.chaos_enabled is False
    adapter = registry.get_adapter("groq")
    # With chaos off, the wrapper must not be in the call path.
    assert adapter.__class__.__name__ != "ChaosAdapter"


# ---- Full lifecycle: every stage actually happens ------------------------
async def test_full_lifecycle_stages_published():
    await _reset()
    await _clear_cache()
    from app.api.routes_chat import chat
    from app.models.schemas import ChatRequest

    events: list[dict] = []
    pubsub = get_redis().pubsub()
    await pubsub.subscribe(TRACE_CHANNEL)
    await asyncio.sleep(0.2)

    prompt = f"integration lifecycle {uuid.uuid4()}: say hi"

    stop = asyncio.Event()

    async def collect():
        # NB: redis-py asyncio get_message() can spuriously return None even when
        # a message is pending, so we CONTINUE on None (as the SSE endpoint does).
        # Run until explicitly stopped after chat + a drain window.
        while not stop.is_set():
            m = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1)
            if m is None:
                continue
            events.append(json.loads(m["data"]))

    collector = asyncio.create_task(collect())
    await asyncio.sleep(0.3)
    async with async_session_maker() as db:
        resp = await chat(ChatRequest(prompt=prompt), db)
    # Drain trailing fire-and-forget publishes (e.g. the final 'complete').
    await asyncio.sleep(3)
    stop.set()
    await asyncio.wait_for(collector, timeout=10)
    await pubsub.unsubscribe(TRACE_CHANNEL)
    await pubsub.aclose()

    stages = {e["stage"] for e in events}
    assert {"classify", "cache", "route", "call", "complete"} <= stages

    # Request row persisted with real provider + classification.
    async with async_session_maker() as s:
        row = (await s.execute(
            text("SELECT provider_used, classification, status FROM requests "
                 "WHERE id = :id"), {"id": str(resp.request_id)}
        )).first()
    assert row is not None
    assert row[0] == resp.provider_used
    assert resp.status.value in ("success", "cached")

    # The response id, the persisted row and the trace events share one UUID.
    assert {e["request_id"] for e in events} == {str(resp.request_id)}


# ---- All providers rate-limited -> last-resort forced fallback (under load) ----
async def test_all_ratelimited_forces_last_resort_under_load():
    await _reset()
    for p in ["groq", "cerebras", "gemini"]:
        await get_redis().hset(f"ratelimit:{p}", mapping={"tokens": 0, "ts": int(time.time()*1000)})
        # Open every breaker too, so no tier is selectable by any path.
        for _ in range(10):
            await cb.record_failure(p, "x")

    expected = policy.last_resort(Classification.simple)

    async def one():
        return await select_provider(Classification.simple, "hello")

    results = await asyncio.gather(*[one() for _ in range(50)])
    assert all(r.provider == expected for r in results)
    assert all(r.forced_fallback for r in results)
    await _reset()


# ---- Half-open single trial under heavy concurrency ----------------------
async def test_half_open_single_trial_under_load():
    await cb.reset("gemini")
    for _ in range(5):
        await cb.record_failure("gemini", "x")
    await get_redis().hset("circuit:gemini", "opened_at", int(time.time()*1000) - 10**9)
    grants = await asyncio.gather(*[cb.is_available("gemini") for _ in range(100)])
    assert sum(grants) == 1
    await cb.reset("gemini")


# ---- Non-retryable error -> immediate failover (no retry burn) -----------
class _FakeAdapter(ProviderAdapter):
    def __init__(self, name, status):
        self.name = name
        self._status = status
        self.calls = 0

    async def complete(self, prompt, **kw):
        self.calls += 1
        exc = Exception("boom")
        exc.status_code = self._status
        raise ProviderError(self.name, "boom", cause=exc)

    async def health_check(self):
        return False


async def test_non_retryable_immediate_failover():
    fake = _FakeAdapter("groq", 401)
    with pytest.raises(ProviderError):
        await call_with_retry(fake, "hi", max_attempts=3)
    assert fake.calls == 1  # no retries burned on a 401


async def test_retryable_uses_all_attempts():
    fake = _FakeAdapter("groq", 503)
    with pytest.raises(ProviderError):
        await call_with_retry(fake, "hi", max_attempts=3, base_delay=0.01)
    assert fake.calls == 3


# ---- Duplicate-cache-write race under SUSTAINED concurrent load ----------
async def test_dup_cache_write_sustained_load():
    await _clear_cache()
    prompt = "SUSTAINED duplicate cache write race probe"
    # 3 waves of 40 concurrent stores of the same prompt = 120 racing writers.
    for _ in range(3):
        await asyncio.gather(*[
            semantic_cache.store(prompt, f"resp{i}", 3600) for i in range(40)
        ])
    async with async_session_maker() as s:
        n = (await s.execute(text("SELECT count(*) FROM cache_entries"))).scalar()
    assert n == 1, f"expected exactly 1 cache row, got {n}"


# ---- Rate limiter Lua correctness under high concurrency -----------------
async def test_rate_limiter_atomic_under_load():
    await rl.reset("groq")  # capacity 30
    grants = await asyncio.gather(*[rl.acquire("groq") for _ in range(200)])
    assert sum(grants) == 30, f"expected exactly 30 grants, got {sum(grants)}"
    await rl.reset("groq")
