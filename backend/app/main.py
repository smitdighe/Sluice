"""Sluice FastAPI application."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api import (
    routes_admin,
    routes_chat,
    routes_eval,
    routes_health,
    routes_trace,
)
from app.config import settings
from app.core.redis_client import get_redis
from app.db.session import engine
from app.providers.base import ProviderError
from app.workers.inprocess import start_workers, stop_workers
from app.workers.queue_config import close_arq_pool, get_arq_pool

logger = logging.getLogger("sluice")
logging.basicConfig(level=settings.log_level)


def _configured_providers() -> dict[str, bool]:
    return {
        "groq": bool(settings.groq_api_key),
        "cerebras": bool(settings.cerebras_api_key),
        "gemini": bool(settings.gemini_api_key),
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    # DB connectivity.
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        logger.info("database connection: OK")
    except Exception as exc:  # noqa: BLE001
        logger.error("database connection FAILED: %s", exc)

    # Redis (pub/sub bus + resilience state) reachability.
    try:
        await get_redis().ping()
        logger.info("redis connection: OK")
    except Exception as exc:  # noqa: BLE001
        logger.error("redis connection FAILED: %s", exc)

    # arq enqueue pool reachability (workers run as separate processes).
    try:
        await get_arq_pool()
        logger.info("arq pool: OK")
    except Exception as exc:  # noqa: BLE001
        logger.error("arq pool FAILED: %s", exc)

    for name, ok in _configured_providers().items():
        logger.info("provider %s: %s", name, "configured" if ok else "NO KEY")

    # Single-container deploys (no separate worker processes) run the arq
    # pools on this event loop instead.
    if settings.run_workers_in_process:
        await start_workers()

    yield

    if settings.run_workers_in_process:
        await stop_workers()
    await close_arq_pool()


app = FastAPI(title="Sluice", version="0.1.0", lifespan=lifespan)

# Browser dashboard (Vite dev server in dev) calls this API cross-origin.
# Origins come from CORS_ORIGINS so prod can set its own; never hardcoded.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _as_object(detail) -> dict:
    """Coerce any handler detail into the contract's `detail: object`.

    The error envelope is `{error: {type, message, detail}}` where `detail` is
    ALWAYS a JSON object — never a list, never absent. Validation errors are
    naturally a list, so they are nested under `errors`.
    """
    if detail is None:
        return {}
    if isinstance(detail, dict):
        return detail
    if isinstance(detail, (list, tuple)):
        return {"errors": list(detail)}
    return {"message": str(detail)}


def _error(status: int, err_type: str, message: str, detail=None) -> JSONResponse:
    """Consistent error envelope across all routers."""
    body = {
        "error": {
            "type": err_type,
            "message": message,
            "detail": _as_object(jsonable_encoder(detail)),
        }
    }
    return JSONResponse(status_code=status, content=body)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch-all so a crash still answers with the contract's error envelope
    rather than Starlette's plain-text 500. The cause is logged, not returned."""
    logger.exception("unhandled error on %s %s", request.method, request.url.path)
    return _error(500, "internal_error", "internal server error")


@app.exception_handler(ProviderError)
async def provider_error_handler(request: Request, exc: ProviderError) -> JSONResponse:
    return _error(502, "provider_error", str(exc), {"provider": exc.provider})


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return _error(422, "validation_error", "request validation failed",
                  {"errors": jsonable_encoder(exc.errors())})


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    detail = exc.detail
    if isinstance(detail, str):
        return _error(exc.status_code, "http_error", detail)
    # Structured detail (e.g. chat 502 {error, trace}) — keep under detail.
    # An explicit "type" key lets a route name its own error class.
    err_type, message = "http_error", "error"
    if isinstance(detail, dict):
        err_type = str(detail.get("type") or err_type)
        message = str(detail.get("error") or message)
    return _error(exc.status_code, err_type, message, detail)


app.include_router(routes_chat.router)
app.include_router(routes_health.router)
app.include_router(routes_eval.router)
app.include_router(routes_admin.router)
app.include_router(routes_trace.router)
