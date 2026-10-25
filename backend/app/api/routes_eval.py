"""Eval endpoints — enqueue async runs (Phase 5) + list/detail views (Phase 6)."""
from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db
from app.eval.judge import SCORE_MAX, SCORE_MIN
from app.eval.runner import DEFAULT_PROVIDER
from app.models.db_models import EvalResult, EvalRun, EvalRunStatus
from app.workers.eval_worker import enqueue_eval_run

router = APIRouter(prefix="/v1/eval", tags=["eval"])

_DEFAULT_GOLDEN_SET = str(
    Path(__file__).resolve().parents[1] / "eval" / "golden_set" / "starter.json"
)

#: Hard cap on ``limit``. Emitted into the OpenAPI schema as ``maximum`` and
#: restated in the param description so clients don't discover it via a 422.
MAX_PAGE = 200
_LIMIT_DESC = f"Page size. Must be between 1 and {MAX_PAGE} (inclusive); larger values are rejected with 422."

#: Score fields are integers 1..5 (see app.eval.judge) or null when a dimension
#: could not be judged. NOT a 0–1 float.
_SCORE_DESC = f"Judge score, integer {SCORE_MIN}-{SCORE_MAX} inclusive, or null if not scored."


class EvalRunRequest(BaseModel):
    golden_set_path: str = _DEFAULT_GOLDEN_SET
    provider: str = DEFAULT_PROVIDER


class EvalRunAccepted(BaseModel):
    run_id: uuid.UUID
    status: EvalRunStatus


class EvalRunSummary(BaseModel):
    """List-view row. ``status`` is the contract enum — terminal success is
    ``complete``, never "completed"."""

    run_id: uuid.UUID
    status: EvalRunStatus
    provider: str
    num_prompts: int
    mean_relevance: float | None = None
    mean_coherence: float | None = None
    mean_correctness: float | None = None
    pass_rate: float | None = None


class EvalAggregates(BaseModel):
    """Run-level aggregates, nested under ``aggregates`` in the detail view."""

    relevance_mean: float | None = None
    coherence_mean: float | None = None
    correctness_mean: float | None = None
    pass_rate: float | None = None


class EvalScoreOut(BaseModel):
    """One judged golden-set item. ``provider`` is who GENERATED the response;
    ``judge_provider`` is who scored it."""

    prompt: str
    provider: str
    relevance: int | None = Field(None, ge=SCORE_MIN, le=SCORE_MAX, description=_SCORE_DESC)
    coherence: int | None = Field(None, ge=SCORE_MIN, le=SCORE_MAX, description=_SCORE_DESC)
    correctness: int | None = Field(None, ge=SCORE_MIN, le=SCORE_MAX, description=_SCORE_DESC)
    # Additive context (non-breaking): judging provenance for the detail table.
    expected_category: str | None = None
    judge_provider: str
    cross_provider: bool


class EvalRunDetail(BaseModel):
    run_id: uuid.UUID
    status: EvalRunStatus
    provider: str
    num_prompts: int
    threshold: float
    aggregates: EvalAggregates
    scores: list[EvalScoreOut]


class Paginated(BaseModel):
    items: list
    limit: int
    offset: int
    total: int


def _summary(run: EvalRun) -> EvalRunSummary:
    return EvalRunSummary(
        run_id=run.id, status=EvalRunStatus(run.status), provider=run.provider,
        num_prompts=run.num_prompts, mean_relevance=run.mean_relevance,
        mean_coherence=run.mean_coherence, mean_correctness=run.mean_correctness,
        pass_rate=run.pass_rate,
    )


@router.post("/run", response_model=EvalRunAccepted, status_code=202)
async def trigger_eval(req: EvalRunRequest) -> EvalRunAccepted:
    run_id = await enqueue_eval_run(req.golden_set_path, req.provider)
    return EvalRunAccepted(run_id=run_id, status=EvalRunStatus.queued)


@router.get("/runs", response_model=Paginated)
async def list_runs(
    db: AsyncSession = Depends(get_db),
    limit: int = Query(50, ge=1, le=MAX_PAGE, description=_LIMIT_DESC),
    offset: int = Query(0, ge=0),
) -> Paginated:
    total = (await db.execute(select(func.count()).select_from(EvalRun))).scalar() or 0
    runs = (
        await db.execute(
            select(EvalRun).order_by(EvalRun.created_at.desc()).limit(limit).offset(offset)
        )
    ).scalars().all()
    return Paginated(items=[_summary(r).model_dump(mode="json") for r in runs],
                     limit=limit, offset=offset, total=total)


@router.get("/runs/{run_id}", response_model=EvalRunDetail)
async def run_detail(run_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> EvalRunDetail:
    """Detail view: run-level means live under ``aggregates``; per-item rows
    under ``scores`` (each carrying the generating ``provider``)."""
    run = (
        await db.execute(select(EvalRun).where(EvalRun.id == run_id))
    ).scalar_one_or_none()
    if run is None:
        raise HTTPException(status_code=404, detail="eval run not found")
    results = (
        await db.execute(select(EvalResult).where(EvalResult.run_id == run_id))
    ).scalars().all()
    return EvalRunDetail(
        run_id=run.id,
        status=EvalRunStatus(run.status),
        provider=run.provider,
        num_prompts=run.num_prompts,
        threshold=run.threshold,
        aggregates=EvalAggregates(
            relevance_mean=run.mean_relevance,
            coherence_mean=run.mean_coherence,
            correctness_mean=run.mean_correctness,
            pass_rate=run.pass_rate,
        ),
        scores=[
            EvalScoreOut(
                prompt=r.prompt,
                provider=r.generated_by,
                relevance=r.relevance,
                coherence=r.coherence,
                correctness=r.correctness,
                expected_category=r.expected_category,
                judge_provider=r.judge_provider,
                cross_provider=r.cross_provider,
            )
            for r in results
        ],
    )
