"""Semantic cache backed by pgvector.

Distance metric matches the Phase 1 HNSW index: cosine (vector_cosine_ops).
similarity = 1 - cosine_distance.

Concurrency: store() serializes on a Postgres transaction-level advisory lock
keyed by the normalized prompt, and re-checks for an existing entry under that
lock before inserting. A UNIQUE constraint on prompt_hash is the hard backstop
against exact-duplicate rows if two writers ever slip past the lock.
"""
from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from app.core.cache.embedder import embed
from app.db.session import async_session_maker
from app.models.db_models import CacheEntry
from app.models.vector_models import CacheEmbedding

DEFAULT_THRESHOLD = 0.92


def _normalize(prompt: str) -> str:
    return " ".join(prompt.split()).lower()


def _hash(prompt: str) -> str:
    return hashlib.sha256(_normalize(prompt).encode("utf-8")).hexdigest()


def _now() -> datetime:
    return datetime.now(UTC)


async def _nearest(session, embedding: list[float], threshold: float):
    """Return (CacheEntry, similarity) for the best non-expired match, or None."""
    distance = CacheEmbedding.embedding.cosine_distance(embedding).label("distance")
    stmt = (
        select(CacheEntry, distance)
        .join(CacheEmbedding, CacheEmbedding.id == CacheEntry.id)
        .where(CacheEntry.ttl_expires_at > func.now())
        .order_by(distance)
        .limit(1)
    )
    row = (await session.execute(stmt)).first()
    if row is None:
        return None
    entry, dist = row
    similarity = 1.0 - float(dist)
    if similarity < threshold:
        return None
    return entry, similarity


async def _register_hit(session, entry: CacheEntry) -> CacheEntry:
    entry.hit_count += 1
    entry.last_hit_at = _now()
    await session.commit()
    session.expunge(entry)
    return entry


async def lookup(prompt: str, threshold: float = DEFAULT_THRESHOLD) -> CacheEntry | None:
    """Return a cached entry matching ``prompt``.

    Fast path: an exact (normalized-hash) hit is served WITHOUT computing an
    embedding — the embedding model is the dominant per-request cost, so skipping
    it for exact repeats (the common cache-hit case) drastically cuts hot-path
    latency under load. Only on an exact miss do we embed and run the pgvector
    semantic search for paraphrase matches.
    """
    prompt_hash = _hash(prompt)
    async with async_session_maker() as session:
        exact = (
            await session.execute(
                select(CacheEntry).where(
                    CacheEntry.prompt_hash == prompt_hash,
                    CacheEntry.ttl_expires_at > func.now(),
                )
            )
        ).scalar_one_or_none()
        if exact is not None:
            return await _register_hit(session, exact)

        # Slow path: semantic (paraphrase) match requires the embedding.
        embedding = embed(prompt)
        match = await _nearest(session, embedding, threshold)
        if match is None:
            return None
        return await _register_hit(session, match[0])


async def store(
    prompt: str,
    response: str,
    ttl_seconds: int,
    provider: str | None = None,
    threshold: float = DEFAULT_THRESHOLD,
) -> CacheEntry:
    """Store an entry + embedding atomically, deduplicating concurrent writes.

    ``provider`` is the provider that generated ``response``; it is persisted so a
    later hit can report the original generator as ``provider_used``.
    """
    embedding = embed(prompt)
    normalized = _normalize(prompt)
    prompt_hash = _hash(prompt)
    expires = _now() + timedelta(seconds=ttl_seconds)

    async with async_session_maker() as session:
        # Serialize concurrent writers for this prompt.
        await session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": normalized}
        )

        # Re-check under the lock: exact-hash first, then semantic neighbor.
        existing = (
            await session.execute(
                select(CacheEntry).where(CacheEntry.prompt_hash == prompt_hash)
            )
        ).scalar_one_or_none()
        if existing is None:
            match = await _nearest(session, embedding, threshold)
            if match is not None:
                existing = match[0]

        if existing is not None:
            await session.commit()  # release the advisory lock
            session.expunge(existing)
            return existing

        entry = CacheEntry(
            prompt_text=prompt,
            prompt_hash=prompt_hash,
            response_text=response,
            provider=provider,
            ttl_expires_at=expires,
        )
        session.add(entry)
        try:
            await session.flush()
        except IntegrityError:
            # Backstop: a concurrent writer won the unique constraint race.
            await session.rollback()
            async with async_session_maker() as s2:
                found = (
                    await s2.execute(
                        select(CacheEntry).where(CacheEntry.prompt_hash == prompt_hash)
                    )
                ).scalar_one()
                s2.expunge(found)
                return found

        session.add(CacheEmbedding(id=entry.id, embedding=embedding))
        await session.commit()
        session.expunge(entry)
        return entry
