"""Cache-write queue: move semantic_cache.store() off the request hot path.

The response is already returned to the caller by the time the job runs. A failed
write is logged and dropped — never retried unboundedly (see CacheWorkerSettings
max_tries=1). Duplicate protection is unchanged from Phase 3: store() takes a
Postgres advisory lock + relies on the prompt_hash UNIQUE constraint, which hold
across worker-process concurrency exactly as they do across request concurrency.
"""
from __future__ import annotations

import logging

from app.core.cache import semantic_cache
from app.workers.queue_config import CACHE_QUEUE, get_arq_pool

logger = logging.getLogger("sluice.cache_writer")


async def cache_write(
    ctx, prompt: str, response: str, ttl_seconds: int, provider: str | None = None
) -> str:
    """arq job: perform the Phase 3 semantic cache store.

    ``provider`` defaults to None so jobs enqueued by an older API process (4-arg
    payload) still run during a rolling restart — they just store no generator.
    """
    entry = await semantic_cache.store(prompt, response, ttl_seconds, provider)
    return str(entry.id)


async def enqueue_cache_write(
    prompt: str, response: str, ttl_seconds: int, provider: str | None = None
) -> None:
    """Fire-and-forget from the request's perspective.

    If Redis/enqueue is unavailable we DROP the write (log + return) rather than
    block the request path — a lost cache write is a perf loss, not correctness.
    """
    try:
        pool = await get_arq_pool()
        await pool.enqueue_job(
            "cache_write", prompt, response, ttl_seconds, provider,
            _queue_name=CACHE_QUEUE,
        )
    except Exception as exc:  # noqa: BLE001 — never propagate into the request path
        logger.warning("dropped cache write (enqueue failed): %s", exc)
