"""Shared FastAPI dependencies — the single source for DB / Redis / arq / registry."""
from __future__ import annotations

from collections.abc import AsyncGenerator

import redis.asyncio as redis
from arq.connections import ArqRedis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.redis_client import get_redis as _get_redis_client
from app.db.session import get_db as _get_db
from app.providers import registry
from app.workers.queue_config import get_arq_pool as _get_arq_pool


async def get_db() -> AsyncGenerator[AsyncSession]:
    async for session in _get_db():
        yield session


async def get_redis() -> redis.Redis:
    return _get_redis_client()


async def get_arq_pool() -> ArqRedis:
    return await _get_arq_pool()


def get_registry():
    return registry
