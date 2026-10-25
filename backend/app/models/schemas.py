"""Pydantic v2 API schemas — intentionally decoupled from ORM internals."""
from __future__ import annotations

import uuid
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models.db_models import Classification, RequestStatus


class ChatMetadata(BaseModel):
    """Optional routing hints on a chat request.

    Typed rather than ``dict[str, str]`` because the contract declares
    ``batch_hint`` as a **bool** — a str-valued dict rejected ``true`` with a 422.
    ``extra="allow"`` keeps the contract's open ``...`` shape: unknown hint keys
    pass through untouched instead of failing validation.
    """

    model_config = ConfigDict(extra="allow")

    #: Caller-declared "this is bulk/throughput work" flag. Routed as bulk.
    batch_hint: bool | None = None
    #: Direct classification override ("simple" | "complex" | "bulk").
    category: str | None = None
    classification: str | None = None

    def hints(self) -> dict[str, Any]:
        """Flat mapping of every hint, declared and extra, for the classifier."""
        return self.model_dump(exclude_none=True)


class ChatRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=32000)
    metadata: ChatMetadata | None = None


class SkippedProvider(BaseModel):
    """One provider the router passed over before landing on the one it used."""

    provider: str
    reason: str


class FallbackInfo(BaseModel):
    skipped: list[SkippedProvider]


class ChatResponse(BaseModel):
    #: Correlates the response with the persisted `requests` row AND with the
    #: `request_id` on every /v1/trace/stream event for this call — they are the
    #: same UUID.
    request_id: uuid.UUID
    response: str
    classification: Classification
    provider_used: str | None = None
    latency_ms: int | None = None
    status: RequestStatus
    #: null when the router's first choice was used. Never omitted, never [].
    fallback_info: FallbackInfo | None = None
