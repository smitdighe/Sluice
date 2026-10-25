"""Shared async Redis client (single bounded, blocking connection pool).

A BlockingConnectionPool is used deliberately: under burst load a single request
touches Redis several times (rate limiter, circuit breaker, trace publish), so a
spike of concurrent ops can momentarily exceed the pool. A blocking pool makes
callers wait briefly for a free connection instead of raising MaxConnectionsError
(observed under 200-way concurrency in the Phase 7 load pass).
"""
from __future__ import annotations

import redis.asyncio as redis
from redis.asyncio import BlockingConnectionPool

from app.config import settings

# Bound the pool but block (up to `timeout`s) when momentarily exhausted.
MAX_CONNECTIONS = 64
POOL_WAIT_TIMEOUT = 30

_client: redis.Redis | None = None


def get_redis() -> redis.Redis:
    global _client
    if _client is None:
        pool = BlockingConnectionPool.from_url(
            settings.redis_url,
            max_connections=MAX_CONNECTIONS,
            timeout=POOL_WAIT_TIMEOUT,
            encoding="utf-8",
            decode_responses=True,
        )
        _client = redis.Redis(connection_pool=pool)
    return _client
