"""Per-provider circuit breaker with Redis-persisted state.

States: closed -> open -> half_open -> closed. State lives in Redis so it
survives across workers/restarts. All transition decisions run in Lua scripts so
the half-open "single trial" claim is atomic — exactly one concurrent request
becomes the trial; the rest see the provider as unavailable until it resolves.

Transitions are also appended to ProviderHealthLog (Phase 1 model).
"""
from __future__ import annotations

import time
from typing import cast

from app.core.redis_client import get_redis
from app.core.resilience.limits import breaker_for
from app.db.session import async_session_maker
from app.models.db_models import CircuitState, ProviderHealthLog, ProviderName

# is_available: open->half_open transition + trial claim, atomic.
# ARGV: now_ms, open_ms.  Returns {status, available, transitioned}.
_AVAIL_LUA = """
local key = KEYS[1]
local now = tonumber(ARGV[1])
local open_ms = tonumber(ARGV[2])
local d = redis.call('HMGET', key, 'state', 'opened_at', 'trial')
local state = d[1]
if state == false or state == nil or state == 'closed' then
  return {'closed', 1, 0}
end
if state == 'open' then
  local opened = tonumber(d[2]) or now
  if now - opened >= open_ms then
    redis.call('HSET', key, 'state', 'half_open', 'trial', 1)
    return {'half_open', 1, 1}
  end
  return {'open', 0, 0}
end
if state == 'half_open' then
  local trial = tonumber(d[3]) or 0
  if trial == 0 then
    redis.call('HSET', key, 'trial', 1)
    return {'half_open', 1, 0}
  end
  return {'half_open', 0, 0}
end
return {state, 0, 0}
"""

# record_failure. ARGV: now_ms, threshold. Returns {state, failures, transitioned}.
_FAIL_LUA = """
local key = KEYS[1]
local now = tonumber(ARGV[1])
local threshold = tonumber(ARGV[2])
local d = redis.call('HMGET', key, 'state', 'failures')
local state = d[1] or 'closed'
local failures = (tonumber(d[2]) or 0) + 1
if state == 'half_open' then
  redis.call('HSET', key, 'state', 'open', 'failures', failures, 'opened_at', now, 'trial', 0)
  return {'open', failures, 1}
elseif state == 'closed' and failures >= threshold then
  redis.call('HSET', key, 'state', 'open', 'failures', failures, 'opened_at', now, 'trial', 0)
  return {'open', failures, 1}
else
  redis.call('HSET', key, 'failures', failures)
  return {state, failures, 0}
end
"""

# record_success. Returns {state, 0, transitioned}.
_SUCCESS_LUA = """
local key = KEYS[1]
local d = redis.call('HMGET', key, 'state')
local state = d[1] or 'closed'
redis.call('HSET', key, 'state', 'closed', 'failures', 0, 'trial', 0)
if state ~= 'closed' then
  return {'closed', 0, 1}
end
return {'closed', 0, 0}
"""


def _key(provider: str) -> str:
    return f"circuit:{provider}"


async def _log_transition(provider: str, state: str, error_count: int, last_error: str | None):
    try:
        provider_enum = ProviderName(provider)
    except ValueError:
        return
    async with async_session_maker() as session:
        session.add(
            ProviderHealthLog(
                provider=provider_enum,
                status=CircuitState(state),
                error_count=error_count,
                last_error=last_error,
            )
        )
        await session.commit()


async def is_available(provider: str) -> bool:
    cfg = breaker_for(provider)
    r = get_redis()
    now_ms = int(time.time() * 1000)
    _status, available, transitioned = await r.eval(
        _AVAIL_LUA, 1, _key(provider), now_ms, int(cfg.open_seconds * 1000)
    )
    if int(transitioned) == 1:
        await _log_transition(provider, "half_open", 0, None)
    return bool(int(available))


async def record_failure(provider: str, error: str | None = None) -> None:
    cfg = breaker_for(provider)
    r = get_redis()
    now_ms = int(time.time() * 1000)
    _state, failures, transitioned = await r.eval(
        _FAIL_LUA, 1, _key(provider), now_ms, cfg.failure_threshold
    )
    if int(transitioned) == 1:
        await _log_transition(provider, "open", int(failures), error)


async def record_success(provider: str) -> None:
    r = get_redis()
    _state, _zero, transitioned = await r.eval(_SUCCESS_LUA, 1, _key(provider))
    if int(transitioned) == 1:
        await _log_transition(provider, "closed", 0, None)


async def get_state(provider: str) -> str:
    """Current state string (diagnostics/tests)."""
    r = get_redis()
    # decode_responses=True -> str at runtime; redis-py types hget as bytes|str.
    state = cast("str | None", await r.hget(_key(provider), "state"))
    return state or "closed"


async def get_failures(provider: str) -> int:
    """Current consecutive-failure count (reset to 0 on success).

    Surfaced as ``error_count`` on GET /v1/admin/providers.
    """
    r = get_redis()
    raw = cast("str | None", await r.hget(_key(provider), "failures"))
    try:
        return int(float(raw)) if raw is not None else 0
    except (TypeError, ValueError):
        return 0


async def reset(provider: str) -> None:
    """Clear breaker state (test helper)."""
    await get_redis().delete(_key(provider))
