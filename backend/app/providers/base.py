"""Provider adapter contract.

Every provider is reached only through this interface. Raw SDK exceptions must be
wrapped in ProviderError at the adapter boundary — nothing SDK-specific escapes.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from pydantic import BaseModel


class ProviderResponse(BaseModel):
    text: str
    tokens_used: int
    latency_ms: int
    raw_response: Any | None = None


class ProviderError(Exception):
    """Raised by adapters on any failure. Wraps the underlying cause."""

    def __init__(self, provider: str, message: str, *, cause: Exception | None = None):
        self.provider = provider
        self.cause = cause
        super().__init__(f"[{provider}] {message}")


class ProviderAdapter(ABC):
    #: Provider identifier — matches ProviderName in db_models.
    name: str

    @abstractmethod
    async def complete(self, prompt: str, **kwargs: Any) -> ProviderResponse:
        """Run a single completion. Raise ProviderError on failure."""
        raise NotImplementedError

    @abstractmethod
    async def health_check(self) -> bool:
        """Return True if the provider is reachable/authenticated."""
        raise NotImplementedError
