"""arq worker entrypoints — one WorkerSettings per queue, each its own pool.

Run (separate processes, each with its own concurrency):
    arq app.workers.worker.CacheWorkerSettings
    arq app.workers.worker.EvalWorkerSettings
    arq app.workers.worker.MaintenanceWorkerSettings

Keeping them in separate processes is the whole point: an eval backlog can never
delay cache writes, and maintenance never competes with either for capacity.
"""
from __future__ import annotations

from typing import ClassVar

from arq import cron

from app.workers.cache_writer import cache_write
from app.workers.eval_worker import eval_run
from app.workers.maintenance import purge_cache, quota_rollover
from app.workers.queue_config import (
    CACHE_QUEUE,
    EVAL_QUEUE,
    MAINTENANCE_QUEUE,
    redis_settings,
)


class CacheWorkerSettings:
    functions: ClassVar = [cache_write]
    redis_settings = redis_settings()
    queue_name = CACHE_QUEUE
    # High concurrency (volume), short timeout, NO retry — a failed cache write
    # is dropped, never re-attempted (avoids writing stale entries after the fact).
    max_jobs = 20
    job_timeout = 15
    max_tries = 1
    keep_result = 0


class EvalWorkerSettings:
    functions: ClassVar = [eval_run]
    redis_settings = redis_settings()
    queue_name = EVAL_QUEUE
    # Exactly one eval at a time — real provider calls, must not starve live
    # traffic's rate-limit budget. Long timeout for a full golden-set run.
    max_jobs = 1
    job_timeout = 1800
    max_tries = 1
    keep_result = 3600


class MaintenanceWorkerSettings:
    functions: ClassVar = [purge_cache, quota_rollover]
    redis_settings = redis_settings()
    queue_name = MAINTENANCE_QUEUE
    max_jobs = 1
    job_timeout = 300
    max_tries = 1
    cron_jobs: ClassVar = [
        cron(purge_cache, minute={0, 15, 30, 45}, run_at_startup=False),
        cron(quota_rollover, minute={0}, run_at_startup=False),
    ]
