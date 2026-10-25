"""Injectable fault layer that wraps provider adapters — WITHOUT editing them.

Safety: faults are only ever applied when ``settings.chaos_enabled`` is true.
The registry only constructs ChaosAdapter when that flag is set, so with
CHAOS_ENABLED unset the wrapper does not exist in the call path at all — no Redis
lookup, no branch, verifiably inert.

Faults are stored in Redis (hash ``chaos:faults`` -> {provider: fault_type}) so a
toggle set from one process (test/admin tooling) is seen by the API and every
worker. Fault types: timeout | http_5xx | http_429 | conn_refused.
"""
from __future__ import annotations

from typing import Any, cast

from app.core.redis_client import get_redis
from app.providers.base import ProviderAdapter, ProviderError, ProviderResponse

_FAULT_KEY = "chaos:faults"

VALID_FAULTS = {"timeout", "http_5xx", "http_429", "conn_refused"}


class _FaultCause(Exception):
    """Synthetic underlying cause carrying an HTTP status for retry classification."""

    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


def _make_error(provider: str, fault: str) -> ProviderError:
    cause: Exception
    if fault == "http_5xx":
        cause = _FaultCause("injected 503 service unavailable", status_code=503)
    elif fault == "http_429":
        cause = _FaultCause("injected 429 too many requests", status_code=429)
    elif fault == "timeout":
        cause = TimeoutError("injected request timeout")
    else:  # conn_refused
        cause = ConnectionRefusedError("injected connection refused")
    return ProviderError(provider, f"chaos fault: {fault}", cause=cause)


async def set_fault(provider: str, fault: str) -> None:
    if fault not in VALID_FAULTS:
        raise ValueError(f"unknown fault: {fault}")
    await get_redis().hset(_FAULT_KEY, provider, fault)


async def clear_fault(provider: str) -> None:
    await get_redis().hdel(_FAULT_KEY, provider)


async def clear_all_faults() -> None:
    await get_redis().delete(_FAULT_KEY)


async def get_fault(provider: str) -> str | None:
    # decode_responses=True on the shared client -> str; redis-py types it bytes|str.
    return cast("str | None", await get_redis().hget(_FAULT_KEY, provider))


async def active_faults() -> dict[str, str]:
    return cast("dict[str, str]", await get_redis().hgetall(_FAULT_KEY))


class ChaosAdapter(ProviderAdapter):
    """Wraps a real adapter; raises the configured fault before delegating."""

    def __init__(self, inner: ProviderAdapter):
        self._inner = inner
        self.name = inner.name

    async def complete(self, prompt: str, **kwargs: Any) -> ProviderResponse:
        fault = await get_fault(self.name)
        if fault:
            raise _make_error(self.name, fault)
        return await self._inner.complete(prompt, **kwargs)

    async def health_check(self) -> bool:
        fault = await get_fault(self.name)
        if fault:
            return False
        return await self._inner.health_check()
