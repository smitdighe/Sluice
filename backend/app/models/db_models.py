"""Core relational ORM models."""
from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Classification(enum.Enum):
    simple = "simple"
    complex = "complex"
    bulk = "bulk"


class RequestStatus(enum.Enum):
    success = "success"
    error = "error"
    cached = "cached"


class ProviderName(enum.Enum):
    groq = "groq"
    cerebras = "cerebras"
    gemini = "gemini"


class CircuitState(enum.Enum):
    closed = "closed"
    open = "open"
    half_open = "half_open"


class EvalRunStatus(str, enum.Enum):
    """Lifecycle of an eval run — serialized verbatim in the API contract.

    Terminal success is ``complete`` (NOT "completed"): the wire value is the
    contract enum, so it is defined once here and referenced everywhere that
    sets or reads the column.
    """

    queued = "queued"
    running = "running"
    complete = "complete"
    failed = "failed"


# Shared PG enum type — reused across tables so CREATE TYPE is emitted once.
provider_name_enum = Enum(ProviderName, name="provider_name")


class Request(Base):
    __tablename__ = "requests"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    prompt_text: Mapped[str] = mapped_column(Text)
    classification: Mapped[Classification] = mapped_column(
        Enum(Classification, name="classification")
    )
    provider_used: Mapped[str | None] = mapped_column(String(64), nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[RequestStatus] = mapped_column(
        Enum(RequestStatus, name="request_status")
    )
    error_detail: Mapped[str | None] = mapped_column(Text, nullable=True)


class CacheEntry(Base):
    __tablename__ = "cache_entries"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    prompt_text: Mapped[str] = mapped_column(Text)
    # sha256 of the normalized prompt — UNIQUE, backstops concurrent duplicate writes.
    prompt_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    response_text: Mapped[str] = mapped_column(Text)
    # Provider that actually generated `response_text`. Returned verbatim as
    # `provider_used` on a cache hit — the contract wants the ORIGINAL generator,
    # never a synthetic "cache" value. Nullable only for rows written before this
    # column existed (their originating provider is unrecoverable).
    provider: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    last_hit_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    hit_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    ttl_expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True
    )


class QuotaLedger(Base):
    __tablename__ = "quota_ledger"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    provider: Mapped[ProviderName] = mapped_column(provider_name_enum)
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    tokens_used: Mapped[int] = mapped_column(
        BigInteger, default=0, server_default="0"
    )
    token_budget: Mapped[int] = mapped_column(BigInteger)

    __table_args__ = (
        Index("ix_quota_ledger_provider_period_start", "provider", "period_start"),
    )


class ProviderHealthLog(Base):
    __tablename__ = "provider_health_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    provider: Mapped[ProviderName] = mapped_column(provider_name_enum)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    status: Mapped[CircuitState] = mapped_column(
        Enum(CircuitState, name="circuit_state")
    )
    error_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)


class EvalRun(Base):
    __tablename__ = "eval_runs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    golden_set_path: Mapped[str] = mapped_column(Text)
    provider: Mapped[str] = mapped_column(String(64))
    num_prompts: Mapped[int] = mapped_column(Integer)
    threshold: Mapped[float] = mapped_column(Float)
    # Stored as text (see EvalRunStatus for the allowed values) rather than a PG
    # enum so status vocabulary changes don't need an ALTER TYPE.
    status: Mapped[str] = mapped_column(
        String(16),
        default=EvalRunStatus.complete.value,
        server_default=EvalRunStatus.complete.value,
    )
    mean_relevance: Mapped[float | None] = mapped_column(Float, nullable=True)
    mean_coherence: Mapped[float | None] = mapped_column(Float, nullable=True)
    mean_correctness: Mapped[float | None] = mapped_column(Float, nullable=True)
    pass_rate: Mapped[float | None] = mapped_column(Float, nullable=True)


class EvalResult(Base):
    __tablename__ = "eval_results"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("eval_runs.id", ondelete="CASCADE"), index=True
    )
    prompt: Mapped[str] = mapped_column(Text)
    expected_category: Mapped[str | None] = mapped_column(String(32), nullable=True)
    response_text: Mapped[str] = mapped_column(Text)
    generated_by: Mapped[str] = mapped_column(String(64))
    judge_provider: Mapped[str] = mapped_column(String(64))
    cross_provider: Mapped[bool] = mapped_column(default=True)
    relevance: Mapped[int | None] = mapped_column(Integer, nullable=True)
    coherence: Mapped[int | None] = mapped_column(Integer, nullable=True)
    correctness: Mapped[int | None] = mapped_column(Integer, nullable=True)
    raw_judge_output: Mapped[str | None] = mapped_column(Text, nullable=True)
