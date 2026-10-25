"""Routing policy: classification -> ordered provider tiers to try.

Data, not control flow — tune the table without touching selector logic.

Design rationale:
- Groq  : fastest inference -> default for simple/latency-sensitive.
- Cerebras: high-throughput -> preferred for bulk/batch.
- Gemini : strong reasoning -> preferred/fallback for complex.

Every tier is a rate-limited cloud provider; there is no local zero-limit
provider, so the last entry in each list doubles as that classification's
last-resort fallback (see ``last_resort``).
"""
from __future__ import annotations

from app.models.db_models import Classification

POLICY: dict[Classification, list[str]] = {
    Classification.simple: ["groq", "cerebras", "gemini"],
    Classification.complex: ["gemini", "groq", "cerebras"],
    Classification.bulk: ["cerebras", "groq", "gemini"],
}


def provider_order(classification: Classification) -> list[str]:
    return list(POLICY.get(classification, POLICY[Classification.simple]))


def last_resort(classification: Classification) -> str:
    """Provider to force when every tier is unavailable.

    The least-preferred tier for this classification — forcing it keeps the
    "selection always returns a route" guarantee without a local fallback.
    """
    return provider_order(classification)[-1]
