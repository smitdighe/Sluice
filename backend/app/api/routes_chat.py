"""POST /v1/chat — full request lifecycle (Phase 4).

classify -> cache lookup -> (miss) select provider by policy honoring
circuit-breaker + rate-limiter -> retry-wrapped call -> record breaker
success/failure -> on failure fail over to the next tier -> cache.store on
success -> persist Request with actual provider, classification, fallback trace.

Still synchronous in the request path (queue/worker is Phase 5).

Routing is cloud-only: groq, cerebras, gemini. There is no local/offline tier,
so "everything is circuit-broken" can no longer be absorbed silently. Behavior in
that case, by design:

1. ``select_provider`` still forces this classification's last-resort tier
   (``forced_fallback=True``) and we attempt it once. Forcing a call through an
   open breaker is deliberate — it doubles as the probe that lets a recovered
   provider close its breaker, and it is bounded to a single attempt.
2. If that forced attempt also fails, the request is NOT silently degraded: it
   returns **503 no_route_available** with the full skip list, distinguishing
   "the whole fleet is down" from an ordinary upstream failure (502).
"""
from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import semantic_cache
from app.core.resilience import circuit_breaker
from app.core.resilience.retry import call_with_retry
from app.core.router.classifier import classify
from app.core.router.selector import select_provider
from app.core.trace import publish_event
from app.deps import get_db
from app.models.db_models import Request, RequestStatus
from app.models.schemas import ChatRequest, ChatResponse, FallbackInfo, SkippedProvider
from app.providers.base import ProviderError
from app.workers.cache_writer import enqueue_cache_write

router = APIRouter(prefix="/v1", tags=["chat"])

CACHE_TTL_SECONDS = 3600

#: Skip reason emitted for a provider that was actually called and errored (as
#: opposed to one the selector passed over without calling).
_REASON_CALL_FAILED = "call_failed"


def _fallback_info(skipped: list[dict[str, str]]) -> FallbackInfo | None:
    """Contract shape: null when the first-choice provider served the request."""
    if not skipped:
        return None
    return FallbackInfo(skipped=[SkippedProvider(**s) for s in skipped])


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, db: AsyncSession = Depends(get_db)) -> ChatResponse:
    # One id for the whole request: it is the `requests` row PK, the value on
    # every trace event, and the `request_id` returned to the client — so the
    # dashboard can join an SSE stream to a response without a lookup table.
    request_uuid = uuid.uuid4()
    request_id = str(request_uuid)
    classification, reason = classify(req.prompt, req.metadata)
    publish_event({"request_id": request_id, "stage": "classify",
                   "classification": classification.value, "reason": reason})

    # 1. Cache lookup — a hit skips routing entirely (Phase 3 path, preserved).
    cached = await semantic_cache.lookup(req.prompt)
    publish_event({"request_id": request_id, "stage": "cache",
                   "result": "hit" if cached is not None else "miss"})
    if cached is not None:
        # provider_used is the ORIGINAL generator of the cached text, not "cache"
        # — "cache" is not a provider, and the contract asks for the provider that
        # was actually called. null only for pre-`provider`-column rows, whose
        # generator is unrecoverable.
        origin_provider = cached.provider
        row = Request(
            id=request_uuid,
            prompt_text=req.prompt,
            classification=classification,
            provider_used=origin_provider,
            latency_ms=0,
            status=RequestStatus.cached,
        )
        db.add(row)
        await db.commit()
        await db.refresh(row)
        return ChatResponse(
            request_id=row.id,
            response=cached.response_text,
            classification=classification,
            provider_used=origin_provider,
            latency_ms=0,
            status=RequestStatus.cached,
            # A cache hit never routes, so nothing was skipped.
            fallback_info=None,
        )

    # 2. Route with fail-over across the policy chain.
    trace: dict = {"request_id": request_id, "classification": classification.value,
                   "reason": reason, "cache": "miss", "attempts": []}
    tried: list[str] = []
    text = ""
    latency_ms: int | None = None
    provider_used: str | None = None
    status = RequestStatus.error
    error_detail: str | None = None
    # Client-facing skip list. "already_tried" is dropped — it is a restatement
    # of an earlier entry, not new information for the caller.
    skipped_out: list[dict[str, str]] = []
    exhausted = False

    def _record_skips(entries: list[dict[str, str]]) -> None:
        for entry in entries:
            if entry.get("reason") == "already_tried":
                continue
            if entry not in skipped_out:
                skipped_out.append(entry)

    while True:
        selection = await select_provider(classification, req.prompt, exclude=tried)
        provider = selection.provider
        _record_skips(selection.skipped)
        publish_event({"request_id": request_id, "stage": "route",
                       "selected": provider, "skipped": selection.skipped,
                       "forced_fallback": selection.forced_fallback})
        try:
            result = await call_with_retry(selection.adapter, req.prompt)
            await circuit_breaker.record_success(provider)
            text = result.text
            latency_ms = result.latency_ms
            provider_used = provider
            status = RequestStatus.success
            trace["attempts"].append({"provider": provider, "outcome": "success",
                                      "skipped": selection.skipped,
                                      "forced_fallback": selection.forced_fallback})
            publish_event({"request_id": request_id, "stage": "call",
                           "provider": provider, "outcome": "success",
                           "latency_ms": latency_ms})
            break
        except ProviderError as exc:
            await circuit_breaker.record_failure(provider, str(exc))
            trace["attempts"].append({"provider": provider, "outcome": "failed",
                                      "error": str(exc), "skipped": selection.skipped,
                                      "forced_fallback": selection.forced_fallback})
            publish_event({"request_id": request_id, "stage": "call",
                           "provider": provider, "outcome": "failed", "error": str(exc)})
            tried.append(provider)
            error_detail = str(exc)
            _record_skips([{"provider": provider, "reason": _REASON_CALL_FAILED}])
            # The forced last-resort attempt failing means the whole cloud fleet
            # is unusable — stop and report it explicitly (503), never degrade.
            if selection.forced_fallback:
                exhausted = True
                break
            continue

    # 3. Cache successful live responses — enqueued (fire-and-forget), so the
    # write happens AFTER the response is returned. Never blocks the request path.
    if status is RequestStatus.success:
        # provider_used rides along so a later hit can report the real generator.
        await enqueue_cache_write(req.prompt, text, CACHE_TTL_SECONDS, provider_used)

    # 4. Persist the Request row.
    row = Request(
        id=request_uuid,
        prompt_text=req.prompt,
        classification=classification,
        provider_used=provider_used,
        latency_ms=latency_ms,
        status=status,
        error_detail=None if status is RequestStatus.success else json.dumps(trace),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)

    publish_event({"request_id": request_id, "stage": "complete",
                   "status": status.value, "provider_used": provider_used,
                   "request_row_id": str(row.id)})

    if status is not RequestStatus.success:
        # 503 = every cloud tier was skipped or failed (no route left, and no
        # local tier to absorb it). 502 = an upstream provider errored while
        # routes remained. Both use the standard error envelope.
        raise HTTPException(
            status_code=503 if exhausted else 502,
            detail={
                "type": "no_route_available" if exhausted else "provider_error",
                "error": ("all providers unavailable — every cloud tier was "
                          f"circuit-broken, rate-limited or failing: {error_detail}")
                         if exhausted else error_detail,
                "request_id": request_id,
                "skipped": skipped_out,
                "trace": trace,
            },
        )

    return ChatResponse(
        request_id=row.id,
        response=text,
        classification=classification,
        provider_used=provider_used,
        latency_ms=latency_ms,
        status=status,
        fallback_info=_fallback_info(skipped_out),
    )
