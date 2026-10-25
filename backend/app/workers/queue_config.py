"""arq queue configuration.

Why arq (not Celery): the stack is async-first (FastAPI + async SQLAlchemy) and
Redis is already a running dependency. arq is async-native and Redis-backed with
no separate broker/result-backend to operate. Celery would bolt a sync worker
model and an extra broker onto an otherwise async system.

Three queues, each with its own worker pool (see worker.py) so their concurrency
never competes:
  - sluice:cache        high volume, short timeout, NO retry (a missed cache
                        write is a perf loss, not a correctness bug; retrying
                        risks writing a stale entry after the response is gone)
  - sluice:eval         long, expensive, concurrency=1 (real provider calls must
                        not burn rate-limit budget meant for live traffic)
  - sluice:maintenance  cron-driven purge/rollover, concurrency=1
"""
from __future__ import annotations

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings

from app.config import settings

CACHE_QUEUE = "sluice:cache"
EVAL_QUEUE = "sluice:eval"
MAINTENANCE_QUEUE = "sluice:maintenance"


def redis_settings() -> RedisSettings:
    # Reuse the single app Redis (REDIS_URL) — no second Redis instance.
    return RedisSettings.from_dsn(settings.redis_url)


_pool: ArqRedis | None = None


async def get_arq_pool() -> ArqRedis:
    """Shared enqueue pool for the FastAPI process."""
    global _pool
    if _pool is None:
        _pool = await create_pool(redis_settings())
    return _pool


async def close_arq_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.aclose()
        _pool = None
