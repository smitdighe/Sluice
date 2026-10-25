"""Cerebras provider adapter — bare working call, no resilience logic."""
from __future__ import annotations

import time
from typing import Any

from app.config import settings
from app.providers.base import ProviderAdapter, ProviderError, ProviderResponse

DEFAULT_MODEL = "llama3.1-8b"


class CerebrasAdapter(ProviderAdapter):
    name = "cerebras"

    def __init__(self) -> None:
        self._api_key = settings.cerebras_api_key
        self._client = None

    def _get_client(self):
        if not self._api_key:
            raise ProviderError(self.name, "CEREBRAS_API_KEY not configured")
        if self._client is None:
            from cerebras.cloud.sdk import AsyncCerebras

            self._client = AsyncCerebras(api_key=self._api_key)
        return self._client

    async def complete(self, prompt: str, **kwargs: Any) -> ProviderResponse:
        client = self._get_client()
        model = kwargs.get("model", DEFAULT_MODEL)
        start = time.perf_counter()
        try:
            resp = await client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=kwargs.get("max_tokens", 256),
            )
        except ProviderError:
            raise
        except Exception as exc:  # wrap at boundary
            raise ProviderError(self.name, str(exc), cause=exc) from exc
        latency_ms = int((time.perf_counter() - start) * 1000)
        text = resp.choices[0].message.content or ""
        tokens = getattr(getattr(resp, "usage", None), "total_tokens", 0) or 0
        return ProviderResponse(
            text=text,
            tokens_used=tokens,
            latency_ms=latency_ms,
            raw_response=resp.model_dump() if hasattr(resp, "model_dump") else None,
        )

    async def health_check(self) -> bool:
        try:
            client = self._get_client()
            await client.models.list()
            return True
        except Exception:  # noqa: BLE001
            return False
