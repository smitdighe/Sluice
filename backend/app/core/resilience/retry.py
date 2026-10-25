"""Retry with exponential backoff + jitter around a provider adapter call.

Retryable: timeouts, 429, and 5xx. Non-retryable: 4xx auth/validation (401/403/
400/404/422) — retrying a bad key just wastes budget and delays failover. A 429
additionally drains the provider's local rate-limit bucket so our assumed refill
rate self-corrects toward the provider's real (tighter) limit.
"""
from __future__ import annotations

import asyncio
import random

from app.core.resilience import rate_limiter
from app.providers.base import ProviderAdapter, ProviderError, ProviderResponse

RETRYABLE_STATUS = {408, 429, 500, 502, 503, 504}
NON_RETRYABLE_STATUS = {400, 401, 403, 404, 422}
_RETRYABLE_NAME_HINTS = ("timeout", "connect", "temporarily", "overloaded", "unavailable")


def _status_of(exc: Exception | None) -> int | None:
    if exc is None:
        return None
    status = getattr(exc, "status_code", None)
    if status is None:
        response = getattr(exc, "response", None)
        status = getattr(response, "status_code", None)
    return int(status) if status is not None else None


def classify(exc: Exception | None) -> tuple[bool, int | None]:
    """Return (retryable, status_code)."""
    status = _status_of(exc)
    if status is not None:
        if status in RETRYABLE_STATUS:
            return True, status
        if status in NON_RETRYABLE_STATUS:
            return False, status
        # other 4xx -> non-retryable; unexpected -> non-retryable
        return (False, status) if 400 <= status < 500 else (True, status)
    # No status: only retry things that smell transient.
    text = f"{type(exc).__name__} {exc}".lower()
    return any(h in text for h in _RETRYABLE_NAME_HINTS), None


async def call_with_retry(
    adapter: ProviderAdapter,
    prompt: str,
    *,
    max_attempts: int = 3,
    base_delay: float = 0.5,
    factor: float = 2.0,
    max_delay: float = 8.0,
    **kwargs,
) -> ProviderResponse:
    attempt = 0
    while True:
        attempt += 1
        try:
            return await adapter.complete(prompt, **kwargs)
        except ProviderError as exc:
            retryable, status = classify(exc.cause)
            if status == 429:
                # Provider is tighter than assumed — drain our local bucket.
                await rate_limiter.penalize(adapter.name, tokens=5)
            if not retryable or attempt >= max_attempts:
                raise
            delay = min(max_delay, base_delay * (factor ** (attempt - 1)))
            delay += random.uniform(0, delay * 0.25)  # jitter
            await asyncio.sleep(delay)
