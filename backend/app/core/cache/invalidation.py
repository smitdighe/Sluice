"""TTL-based cache invalidation. Callable only — no scheduler wiring (Phase 5)."""
from __future__ import annotations

from datetime import UTC, datetime
from typing import cast

from sqlalchemy import CursorResult, delete, func

from app.db.session import async_session_maker
from app.models.db_models import CacheEntry


def is_stale(entry: CacheEntry) -> bool:
    """True if the entry is past its TTL."""
    expires = entry.ttl_expires_at
    now = datetime.now(UTC)
    if expires.tzinfo is None:
        now = now.replace(tzinfo=None)
    return expires <= now


async def purge_expired() -> int:
    """Delete expired entries (CacheEmbedding cascades). Returns rows purged."""
    async with async_session_maker() as session:
        result = await session.execute(
            delete(CacheEntry).where(CacheEntry.ttl_expires_at <= func.now())
        )
        await session.commit()
        # execute(delete(...)) yields a CursorResult at runtime; the async
        # execute() return type is the base Result, which lacks rowcount.
        return cast(CursorResult, result).rowcount or 0
