"""Health endpoints."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db
from app.providers.registry import all_provider_names, get_adapter

router = APIRouter(prefix="/v1", tags=["health"])


@router.get("/health")
async def health(db: AsyncSession = Depends(get_db)) -> dict:
    """Liveness: app up + DB reachable. No provider sweep."""
    try:
        await db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:  # noqa: BLE001
        db_ok = False
    return {"status": "ok" if db_ok else "degraded", "database": db_ok}


@router.get("/health/providers", response_model=dict[str, bool])
async def provider_health() -> dict[str, bool]:
    """Run health_check() on all adapters concurrently.

    Contract: a FLAT ``{provider: bool}`` map (no ``providers`` wrapper), keyed
    by the registered providers — groq, cerebras, gemini.
    """
    names = all_provider_names()
    results = await asyncio.gather(
        *(get_adapter(n).health_check() for n in names),
        return_exceptions=True,
    )
    return {
        name: (bool(res) if not isinstance(res, Exception) else False)
        for name, res in zip(names, results)
    }
