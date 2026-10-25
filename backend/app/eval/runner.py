"""Eval runner: generate -> judge -> aggregate -> persist."""
from __future__ import annotations

import json
import uuid
from pathlib import Path

from pydantic import BaseModel, Field
from sqlalchemy import select

from app.db.session import async_session_maker
from app.eval.judge import SCORE_MAX, SCORE_MIN, JudgeScore, judge_response
from app.eval.metrics import AggregateMetrics, aggregate
from app.models.db_models import EvalResult, EvalRun, EvalRunStatus
from app.providers.base import ProviderError
from app.providers.registry import get_adapter

# Phase 2 hardcoded generator; overridable via param.
DEFAULT_PROVIDER = "groq"


class EvalItemResult(BaseModel):
    prompt: str
    expected_category: str | None
    response_text: str
    generated_by: str
    judge_provider: str
    cross_provider: bool
    # 1..5 integers or None — see app.eval.judge.SCORE_MIN/SCORE_MAX.
    relevance: int | None = Field(None, ge=SCORE_MIN, le=SCORE_MAX)
    coherence: int | None = Field(None, ge=SCORE_MIN, le=SCORE_MAX)
    correctness: int | None = Field(None, ge=SCORE_MIN, le=SCORE_MAX)
    error: str | None = None


class EvalRunResult(BaseModel):
    run_id: uuid.UUID
    provider: str
    golden_set_path: str
    num_prompts: int
    metrics: AggregateMetrics
    results: list[EvalItemResult]


async def run_eval(
    golden_set_path: str,
    provider: str = DEFAULT_PROVIDER,
    run_id: uuid.UUID | None = None,
) -> EvalRunResult:
    """Run the eval. If ``run_id`` is given, finalize that pre-created EvalRun
    (queued via the worker); otherwise create a fresh one. Sets status=complete.
    """
    items = json.loads(Path(golden_set_path).read_text(encoding="utf-8"))
    adapter = get_adapter(provider)

    scores: list[JudgeScore] = []
    item_results: list[EvalItemResult] = []

    for item in items:
        prompt = item["prompt"]
        expected = item.get("expected_category")
        reference = item.get("reference_answer")

        try:
            completion = await adapter.complete(prompt)
            response_text = completion.text
        except ProviderError as exc:
            item_results.append(
                EvalItemResult(
                    prompt=prompt,
                    expected_category=expected,
                    response_text="",
                    generated_by=provider,
                    judge_provider="",
                    cross_provider=False,
                    relevance=None,
                    coherence=None,
                    correctness=None,
                    error=str(exc),
                )
            )
            continue

        try:
            score = await judge_response(prompt, response_text, provider, reference)
        except ProviderError as exc:
            item_results.append(
                EvalItemResult(
                    prompt=prompt,
                    expected_category=expected,
                    response_text=response_text,
                    generated_by=provider,
                    judge_provider="",
                    cross_provider=False,
                    relevance=None,
                    coherence=None,
                    correctness=None,
                    error=str(exc),
                )
            )
            continue

        scores.append(score)
        item_results.append(
            EvalItemResult(
                prompt=prompt,
                expected_category=expected,
                response_text=response_text,
                generated_by=provider,
                judge_provider=score.judge_provider,
                cross_provider=score.cross_provider,
                relevance=score.relevance,
                coherence=score.coherence,
                correctness=score.correctness,
            )
        )

    metrics = aggregate(scores)

    async with async_session_maker() as session:
        if run_id is not None:
            # Finalize a pre-created (queued) run.
            run = (
                await session.execute(select(EvalRun).where(EvalRun.id == run_id))
            ).scalar_one()
            run.provider = provider
            run.num_prompts = len(items)
            run.threshold = metrics.pass_threshold
            run.mean_relevance = metrics.relevance.mean
            run.mean_coherence = metrics.coherence.mean
            run.mean_correctness = metrics.correctness.mean
            run.pass_rate = metrics.pass_rate
            run.status = EvalRunStatus.complete.value
        else:
            run_id = uuid.uuid4()
            session.add(
                EvalRun(
                    id=run_id,
                    golden_set_path=golden_set_path,
                    provider=provider,
                    num_prompts=len(items),
                    threshold=metrics.pass_threshold,
                    mean_relevance=metrics.relevance.mean,
                    mean_coherence=metrics.coherence.mean,
                    mean_correctness=metrics.correctness.mean,
                    pass_rate=metrics.pass_rate,
                    status=EvalRunStatus.complete.value,
                )
            )
        # Flush the parent EvalRun before children — there is no ORM relationship
        # between EvalRun/EvalResult, so the unit-of-work can't infer FK ordering.
        await session.flush()
        for r in item_results:
            session.add(
                EvalResult(
                    run_id=run_id,
                    prompt=r.prompt,
                    expected_category=r.expected_category,
                    response_text=r.response_text,
                    generated_by=r.generated_by,
                    judge_provider=r.judge_provider or "",
                    cross_provider=r.cross_provider,
                    relevance=r.relevance,
                    coherence=r.coherence,
                    correctness=r.correctness,
                    raw_judge_output=r.error,
                )
            )
        await session.commit()

    return EvalRunResult(
        run_id=run_id,
        provider=provider,
        golden_set_path=golden_set_path,
        num_prompts=len(items),
        metrics=metrics,
        results=item_results,
    )
