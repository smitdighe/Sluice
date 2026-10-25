"""Redis-backed token-bucket rate limiter, one bucket per provider.

Atomicity: the refill + check-and-decrement runs inside a single Lua script, so
concurrent callers can never race a read-then-write. Non-blocking — returns
False immediately when the bucket lacks tokens rather than waiting.
"""
from __future__ import annotations

import time

from app.core.redis_client import get_redis
from app.core.resilience.limits import rate_limit_for

# KEYS[1] = bucket key
# ARGV = capacity, refill_per_sec, now_ms, requested
# Returns 1 if allowed (and decrements), else 0.
_BUCKET_LUA = """
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
if tokens == nil then
  tokens = capacity
  ts = now
end

local elapsed = math.max(0, now - ts) / 1000.0
tokens = math.min(capacity, tokens + elapsed * refill)

local allowed = 0
if tokens >= requested then
  tokens = tokens - requested
  allowed = 1
end

redis.call('HSET', key, 'tokens', tokens, 'ts', now)
-- expire idle buckets after 1h so keys don't accumulate
redis.call('PEXPIRE', key, 3600000)
return allowed
"""


def _key(provider: str) -> str:
    return f"ratelimit:{provider}"


async def acquire(provider: str, tokens: int = 1) -> bool:
    """Try to take ``tokens`` from ``provider``'s bucket. Non-blocking."""
    limit = rate_limit_for(provider)
    r = get_redis()
    now_ms = int(time.time() * 1000)
    result = await r.eval(
        _BUCKET_LUA,
        1,
        _key(provider),
        limit.capacity,
        limit.refill_per_sec,
        now_ms,
        tokens,
    )
    return bool(int(result))


async def penalize(provider: str, tokens: int) -> None:
    """Drain tokens from a bucket after an observed 429 — makes the local bucket
    reflect that the provider is tighter than our assumed refill rate."""
    r = get_redis()
    key = _key(provider)
    current = await r.hget(key, "tokens")
    if current is None:
        return
    new_tokens = max(0.0, float(current) - tokens)
    await r.hset(key, "tokens", new_tokens)


async def available_tokens(provider: str) -> float:
    """Best-effort current token count (diagnostics only)."""
    r = get_redis()
    current = await r.hget(_key(provider), "tokens")
    if current is None:
        return rate_limit_for(provider).capacity
    return float(current)


async def reset(provider: str) -> None:
    """Clear a bucket (test helper)."""
    await get_redis().delete(_key(provider))
