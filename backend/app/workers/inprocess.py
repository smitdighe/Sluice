"""Run the arq worker pools inside the API process.

For single-container hosts with no separate worker type (e.g. Render's free
tier). Enabled by RUN_WORKERS_IN_PROCESS=true; off by default, where the three
pools run as their own processes (see worker.py / docker-compose.yml).

Each pool is still its own arq Worker with its own concurrency limit and Redis
connection, so the isolation between queues holds — only the OS process is
shared.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging

from arq.worker import Worker, create_worker

from app.workers.worker import (
    CacheWorkerSettings,
    EvalWorkerSettings,
    MaintenanceWorkerSettings,
)

logger = logging.getLogger("sluice.workers")

_WORKER_SETTINGS = (CacheWorkerSettings, EvalWorkerSettings, MaintenanceWorkerSettings)

_running: list[tuple[Worker, asyncio.Task[None]]] = []


def _log_exit(name: str, task: asyncio.Task[None]) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.error("in-process worker %s crashed: %r", name, exc)


async def start_workers() -> None:
    for settings_cls in _WORKER_SETTINGS:
        # handle_signals=False: uvicorn owns SIGINT/SIGTERM in this process.
        worker = create_worker(settings_cls, handle_signals=False)
        task = asyncio.create_task(worker.async_run())
        task.add_done_callback(lambda t, n=settings_cls.__name__: _log_exit(n, t))
        _running.append((worker, task))
        logger.info("in-process worker started: %s", settings_cls.__name__)


async def stop_workers() -> None:
    # Not Worker.close(): with handle_signals=False it raises SIGUSR1, which
    # does not exist on Windows, then gathers the jobs it just cancelled.
    while _running:
        worker, task = _running.pop()
        for job in worker.tasks.values():
            job.cancel()
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await task
        if worker.pool is not None:
            with contextlib.suppress(Exception):
                await worker.pool.close(close_connection_pool=True)
