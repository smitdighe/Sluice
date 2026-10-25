"""Provider selection: walk the policy order, honoring breaker + rate limiter.

Ordering note (important): we call ``rate_limiter.acquire()`` **before**
``circuit_breaker.is_available()``. ``is_available`` atomically *claims* the
half-open trial when a provider is eligible, so it must only be called once we've
already secured a rate token and are committed to actually calling that provider.
Reversing the order could claim the single half-open trial and then bail on a
rate-limit miss, leaving the breaker stuck half-open with an unused trial. The
cost is a rate token occasionally spent on a provider whose breaker is open —
cheap and self-healing (buckets refill); a stuck trial is not.

Guarantee: selection never returns nothing. If every tier is unavailable we force
this classification's last-resort provider (the least-preferred tier) regardless
of its breaker/limit state.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.core.resilience import circuit_breaker, rate_limiter
from app.core.router import policy
from app.models.db_models import Classification
from app.providers.base import ProviderAdapter
from app.providers.registry import get_adapter


@dataclass
class SelectionResult:
    adapter: ProviderAdapter
    provider: str
    classification: Classification
    skipped: list[dict[str, str]] = field(default_factory=list)
    forced_fallback: bool = False

    def trace(self) -> dict:
        return {
            "classification": self.classification.value,
            "selected": self.provider,
            "forced_fallback": self.forced_fallback,
            "skipped": self.skipped,
        }


async def select_provider(
    classification: Classification,
    prompt: str,
    exclude: list[str] | None = None,
) -> SelectionResult:
    order = policy.provider_order(classification)
    excluded = set(exclude or ())
    skipped: list[dict[str, str]] = []

    for provider in order:
        if provider in excluded:
            skipped.append({"provider": provider, "reason": "already_tried"})
            continue
        if not await rate_limiter.acquire(provider):
            skipped.append({"provider": provider, "reason": "rate_limited"})
            continue
        if not await circuit_breaker.is_available(provider):
            skipped.append({"provider": provider, "reason": "circuit_unavailable"})
            continue
        return SelectionResult(
            adapter=get_adapter(provider),
            provider=provider,
            classification=classification,
            skipped=skipped,
            forced_fallback=False,
        )

    # Nothing available — force the last-resort tier so a request always routes.
    fallback = policy.last_resort(classification)
    await rate_limiter.acquire(fallback)  # best-effort; do not block on it
    return SelectionResult(
        adapter=get_adapter(fallback),
        provider=fallback,
        classification=classification,
        skipped=skipped,
        forced_fallback=True,
    )
