"""Adapter registry — one singleton instance per provider."""
from __future__ import annotations

from functools import cache

from app.config import settings
from app.providers.base import ProviderAdapter
from app.providers.cerebras_adapter import CerebrasAdapter
from app.providers.gemini_adapter import GeminiAdapter
from app.providers.groq_adapter import GroqAdapter

_ADAPTER_CLASSES: dict[str, type[ProviderAdapter]] = {
    "groq": GroqAdapter,
    "cerebras": CerebrasAdapter,
    "gemini": GeminiAdapter,
}


@cache
def get_adapter(name: str) -> ProviderAdapter:
    """Return the singleton adapter for ``name``. Cached across requests.

    When chaos is enabled the adapter is wrapped in ChaosAdapter; otherwise the
    wrapper is never constructed (inert, zero call-path overhead).
    """
    try:
        cls = _ADAPTER_CLASSES[name]
    except KeyError:
        raise ValueError(f"unknown provider: {name!r}") from None
    adapter = cls()
    if settings.chaos_enabled:
        from app.chaos.fault_injection import ChaosAdapter

        return ChaosAdapter(adapter)
    return adapter


def all_provider_names() -> list[str]:
    return list(_ADAPTER_CLASSES)
