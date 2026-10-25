"""Test-harness fixtures.

pytest-asyncio runs each async test in its own event loop, but the app's Redis
client and arq pool are process-global singletons that bind to the loop they were
first created on. Reusing them across per-test loops raises "Event loop is closed"
/ asyncpg loop-mismatch errors. This is a *test-harness* concern only — the real
app (and each arq worker) runs on a single long-lived loop.

This autouse fixture rebinds those loop-bound singletons to each test's loop and
disposes the DB engine's connections afterwards, so every test starts clean.
"""
from __future__ import annotations

import pytest

import app.core.redis_client as rc
import app.workers.queue_config as qc
from app.db.session import engine


@pytest.fixture(autouse=True)
async def rebind_loop_bound_singletons():
    rc._client = None
    qc._pool = None
    yield
    if rc._client is not None:
        await rc._client.aclose()
        rc._client = None
    if qc._pool is not None:
        await qc._pool.aclose()
        qc._pool = None
    await engine.dispose()
