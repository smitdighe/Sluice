"""Eval queue: run expensive eval jobs off the request path.

Concurrency is pinned to 1 (see EvalWorkerSettings): eval runs make real provider
calls and must not compete with live traffic for rate-limit budget, nor run two
at once.
"""
from __future__ import annotations

import logging
import uuid

from sqlalchemy import update

from app.db.session import async_session_maker
from app.eval.runner import DEFAULT_PROVIDER, run_eval
from app.models.db_models import EvalRun, EvalRunStatus
from app.workers.queue_config import EVAL_QUEUE, get_arq_pool

logger = logging.getLogger("sluice.eval_worker")


async def _set_status(run_id: uuid.UUID, status: str) -> None:
    async with async_session_maker() as session:
        await session.execute(
            update(EvalRun).where(EvalRun.id == run_id).values(status=status)
        )
        await session.commit()


async def eval_run(ctx, run_id: str, golden_set_path: str, provider: str) -> str:
    """arq job: run the eval, updating the pre-created EvalRun's status."""
    rid = uuid.UUID(run_id)
    await _set_status(rid, EvalRunStatus.running.value)
    try:
        await run_eval(golden_set_path, provider, run_id=rid)
    except Exception:  # record failure, do not silently swallow
        logger.exception("eval run %s failed", run_id)
        await _set_status(rid, EvalRunStatus.failed.value)
        raise
    return run_id


async def enqueue_eval_run(
    golden_set_path: str, provider: str = DEFAULT_PROVIDER
) -> uuid.UUID:
    """Create a queued EvalRun placeholder, enqueue the job, return its id."""
    run_id = uuid.uuid4()
    async with async_session_maker() as session:
        session.add(
            EvalRun(
                id=run_id,
                golden_set_path=golden_set_path,
                provider=provider,
                num_prompts=0,
                threshold=0.0,
                status=EvalRunStatus.queued.value,
            )
        )
        await session.commit()

    pool = await get_arq_pool()
    await pool.enqueue_job(
        "eval_run", str(run_id), golden_set_path, provider, _queue_name=EVAL_QUEUE
    )
    return run_id
