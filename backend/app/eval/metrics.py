"""Pure aggregate metrics over JudgeScores. No DB, no side effects."""
from __future__ import annotations

import statistics
from collections.abc import Sequence

from pydantic import BaseModel

from app.eval.judge import JudgeScore

DEFAULT_PASS_THRESHOLD = 3.0


class DimensionStats(BaseModel):
    mean: float | None
    median: float | None
    count: int


class AggregateMetrics(BaseModel):
    relevance: DimensionStats
    coherence: DimensionStats
    correctness: DimensionStats
    pass_rate: float | None
    pass_threshold: float
    n: int


def _stats(values: Sequence[int | None]) -> DimensionStats:
    present = [float(v) for v in values if v is not None]
    if not present:
        return DimensionStats(mean=None, median=None, count=0)
    return DimensionStats(
        mean=round(statistics.mean(present), 3),
        median=round(statistics.median(present), 3),
        count=len(present),
    )


def aggregate(
    scores: Sequence[JudgeScore], pass_threshold: float = DEFAULT_PASS_THRESHOLD
) -> AggregateMetrics:
    rel = _stats([s.relevance for s in scores])
    coh = _stats([s.coherence for s in scores])
    cor = _stats([s.correctness for s in scores])

    # Pass = mean of available dimensions >= threshold, per response.
    passes, judged = 0, 0
    for s in scores:
        dims = [d for d in (s.relevance, s.coherence, s.correctness) if d is not None]
        if not dims:
            continue
        judged += 1
        if statistics.mean(dims) >= pass_threshold:
            passes += 1
    pass_rate = round(passes / judged, 3) if judged else None

    return AggregateMetrics(
        relevance=rel,
        coherence=coh,
        correctness=cor,
        pass_rate=pass_rate,
        pass_threshold=pass_threshold,
        n=len(scores),
    )
