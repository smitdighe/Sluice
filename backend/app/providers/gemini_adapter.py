"""Gemini provider adapter — bare working call, no resilience logic."""
from __future__ import annotations

import time
from typing import Any

from app.config import settings
from app.providers.base import ProviderAdapter, ProviderError, ProviderResponse

# Rolling alias: Google retires pinned Flash versions for new keys, which
# would 404 every call. The alias always resolves to the current Flash model.
DEFAULT_MODEL = "gemini-flash-latest"


class GeminiAdapter(ProviderAdapter):
    name = "gemini"

    def __init__(self) -> None:
        self._api_key = settings.gemini_api_key
        self._client = None

    def _ensure_configured(self):
        if not self._api_key:
            raise ProviderError(self.name, "GEMINI_API_KEY not configured")
        if self._client is None:
            from google import genai

            self._client = genai.Client(api_key=self._api_key)
        return self._client

    async def complete(self, prompt: str, **kwargs: Any) -> ProviderResponse:
        client = self._ensure_configured()

        model_name = kwargs.get("model", DEFAULT_MODEL)
        start = time.perf_counter()
        try:
            resp = await client.aio.models.generate_content(
                model=model_name, contents=prompt
            )
        except ProviderError:
            raise
        except Exception as exc:  # wrap at boundary
            raise ProviderError(self.name, str(exc), cause=exc) from exc
        latency_ms = int((time.perf_counter() - start) * 1000)
        text = resp.text or ""
        tokens = getattr(
            getattr(resp, "usage_metadata", None), "total_token_count", 0
        ) or 0
        return ProviderResponse(
            text=text,
            tokens_used=tokens,
            latency_ms=latency_ms,
            raw_response=None,
        )

    async def health_check(self) -> bool:
        try:
            client = self._ensure_configured()
            await client.aio.models.get(model=DEFAULT_MODEL)
            return True
        except Exception:  # noqa: BLE001
            return False
