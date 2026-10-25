"""Per-provider resilience configuration.

Rate limits reflect the current *free-tier* limits (verified July 2026). The
token bucket here gates on **requests per minute** (the RPM dimension) — the
tightest practical constraint for a gateway. TPM/RPD are recorded for reference
and future use but not separately enforced this phase.

Sources:
- Groq: 30 RPM, 6,000 TPM, 14,400 RPD (llama-3.1-8b-instant free tier)
  https://console.groq.com/docs/rate-limits
- Cerebras: 30 RPM, 60,000 TPM, 1M tokens/day (free tier; newer docs show
  5 RPM / 30k TPM on some models — using the widely-documented 30 RPM here)
  https://inference-docs.cerebras.ai/support/rate-limits
- Gemini: 15 RPM, 1,000,000 TPM, 1,500 RPD (gemini-1.5-flash free tier)
  https://ai.google.dev/gemini-api/docs/rate-limits
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RateLimit:
    rpm: int          # requests per minute — bucket capacity
    tpm: int          # tokens per minute (reference only this phase)
    rpd: int | None   # requests per day (reference only this phase)

    @property
    def capacity(self) -> float:
        return float(self.rpm)

    @property
    def refill_per_sec(self) -> float:
        return self.rpm / 60.0


@dataclass(frozen=True)
class BreakerConfig:
    failure_threshold: int   # consecutive failures before opening
    open_seconds: float      # how long to stay open before half-open trial


RATE_LIMITS: dict[str, RateLimit] = {
    "groq": RateLimit(rpm=30, tpm=6_000, rpd=14_400),
    "cerebras": RateLimit(rpm=30, tpm=60_000, rpd=None),
    "gemini": RateLimit(rpm=15, tpm=1_000_000, rpd=1_500),
}

BREAKER_CONFIG: dict[str, BreakerConfig] = {
    "groq": BreakerConfig(failure_threshold=5, open_seconds=30),
    "cerebras": BreakerConfig(failure_threshold=5, open_seconds=30),
    "gemini": BreakerConfig(failure_threshold=5, open_seconds=30),
}

DEFAULT_RATE_LIMIT = RateLimit(rpm=15, tpm=6_000, rpd=None)
DEFAULT_BREAKER = BreakerConfig(failure_threshold=5, open_seconds=30)


def rate_limit_for(provider: str) -> RateLimit:
    return RATE_LIMITS.get(provider, DEFAULT_RATE_LIMIT)


def breaker_for(provider: str) -> BreakerConfig:
    return BREAKER_CONFIG.get(provider, DEFAULT_BREAKER)
