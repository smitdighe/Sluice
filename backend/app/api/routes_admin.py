"""Admin/dashboard endpoints — read-only views over Phase 1/4/5 state."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.resilience import circuit_breaker, rate_limiter
from app.core.resilience.limits import rate_limit_for
from app.deps import get_db
from app.models.db_models import CacheEntry, QuotaLedger, Request, RequestStatus
from app.providers.registry import all_provider_names

router = APIRouter(prefix="/v1/admin", tags=["admin"])

#: Hard cap on ``limit`` for every paginated admin endpoint. Exposed in the
#: OpenAPI schema (``maximum``) *and* spelled out in each param description so
#: clients can discover it instead of discovering a 422.
MAX_PAGE = 200
_LIMIT_DESC = f"Page size. Must be between 1 and {MAX_PAGE} (inclusive); larger values are rejected with 422."


class QuotaRow(BaseModel):
    provider: str
    period_start: datetime
    period_end: datetime
    tokens_used: int
    token_budget: int
    utilization: float


class Paginated(BaseModel):
    items: list
    limit: int
    offset: int
    total: int


class ProviderState(BaseModel):
    provider: str
    circuit_state: str
    #: Contract field: whole tokens currently left in the provider's bucket.
    rate_limit_remaining: int
    #: Contract field: consecutive failures recorded by the circuit breaker.
    error_count: int
    # Additive diagnostics (non-breaking): the raw float bucket readings the
    # dashboard uses to draw capacity gauges.
    rate_limit_capacity: float
    rate_limit_available: float


class CacheStats(BaseModel):
    #: Contract field: share of requests served from cache (0.0–1.0).
    hit_rate: float
    total_entries: int
    avg_hit_count: float
    # Additive diagnostic: lifetime hits summed across cache entries.
    total_hits: int


def _quota_row(q: QuotaLedger) -> QuotaRow:
    util = (q.tokens_used / q.token_budget) if q.token_budget else 0.0
    return QuotaRow(
        provider=q.provider.value,
        period_start=q.period_start,
        period_end=q.period_end,
        tokens_used=q.tokens_used,
        token_budget=q.token_budget,
        utilization=round(util, 4),
    )


@router.get("/quota", response_model=list[QuotaRow])
async def quota(db: AsyncSession = Depends(get_db)) -> list[QuotaRow]:
    """Current (active-period) quota ledger per provider."""
    rows = (
        await db.execute(
            select(QuotaLedger)
            .where(QuotaLedger.period_end >= func.now())
            .order_by(QuotaLedger.provider, QuotaLedger.period_start.desc())
        )
    ).scalars().all()
    return [_quota_row(q) for q in rows]


@router.get("/quota/history", response_model=Paginated)
async def quota_history(
    db: AsyncSession = Depends(get_db),
    provider: str | None = None,
    start: datetime | None = Query(
        None,
        description="Inclusive lower bound of the window. Returns ledger periods "
                    "that OVERLAP [start, end] — i.e. period_end >= start.",
    ),
    end: datetime | None = Query(
        None,
        description="Inclusive upper bound of the window. Returns ledger periods "
                    "that OVERLAP [start, end] — i.e. period_start <= end.",
    ),
    limit: int = Query(50, ge=1, le=MAX_PAGE, description=_LIMIT_DESC),
    offset: int = Query(0, ge=0),
) -> Paginated:
    """Bounded burn-down history for the dashboard chart.

    ``start``/``end`` filter by **period overlap**, not containment: a ledger row
    is returned when its [period_start, period_end] intersects the requested
    window, so the period a boundary falls inside is never dropped from a chart.
    Both are optional and independent; ``start > end`` is rejected with 422.
    """
    if start is not None and end is not None and start > end:
        raise HTTPException(
            status_code=422,
            detail={"type": "validation_error", "error": "start must be <= end",
                    "start": start.isoformat(), "end": end.isoformat()},
        )

    base = select(QuotaLedger)
    count_q = select(func.count()).select_from(QuotaLedger)
    if provider:
        base = base.where(QuotaLedger.provider == provider)
        count_q = count_q.where(QuotaLedger.provider == provider)
    if start is not None:
        base = base.where(QuotaLedger.period_end >= start)
        count_q = count_q.where(QuotaLedger.period_end >= start)
    if end is not None:
        base = base.where(QuotaLedger.period_start <= end)
        count_q = count_q.where(QuotaLedger.period_start <= end)
    total = (await db.execute(count_q)).scalar() or 0
    rows = (
        await db.execute(
            base.order_by(QuotaLedger.period_start.desc()).limit(limit).offset(offset)
        )
    ).scalars().all()
    return Paginated(items=[_quota_row(q).model_dump() for q in rows],
                     limit=limit, offset=offset, total=total)


@router.get("/providers", response_model=list[ProviderState])
async def providers() -> list[ProviderState]:
    """Live circuit-breaker + rate-limit bucket state (reads Phase 4 Redis state).

    One row per registered provider: groq, cerebras, gemini.
    """
    out: list[ProviderState] = []
    for name in all_provider_names():
        available = await rate_limiter.available_tokens(name)
        out.append(
            ProviderState(
                provider=name,
                circuit_state=await circuit_breaker.get_state(name),
                # Floored: a partially-refilled token cannot be spent, so the
                # contract's integer "remaining" is what's actually claimable.
                rate_limit_remaining=int(available),
                error_count=await circuit_breaker.get_failures(name),
                rate_limit_capacity=rate_limit_for(name).capacity,
                rate_limit_available=round(available, 2),
            )
        )
    return out


@router.get("/cache/stats", response_model=CacheStats)
async def cache_stats(db: AsyncSession = Depends(get_db)) -> CacheStats:
    total_entries, total_hits, avg_hits = (
        await db.execute(
            select(func.count(CacheEntry.id),
                   func.coalesce(func.sum(CacheEntry.hit_count), 0),
                   func.coalesce(func.avg(CacheEntry.hit_count), 0.0))
        )
    ).one()
    total_reqs = (await db.execute(select(func.count(Request.id)))).scalar() or 0
    cached_reqs = (
        await db.execute(
            select(func.count(Request.id)).where(Request.status == RequestStatus.cached)
        )
    ).scalar() or 0
    hit_rate = (cached_reqs / total_reqs) if total_reqs else 0.0
    return CacheStats(
        hit_rate=round(hit_rate, 4),
        total_entries=int(total_entries),
        avg_hit_count=round(float(avg_hits), 3),
        total_hits=int(total_hits),
    )
