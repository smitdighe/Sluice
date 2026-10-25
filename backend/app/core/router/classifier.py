"""Deterministic, rule-based prompt classifier: simple / complex / bulk.

Runs on every request before any provider call — pure string work, no network,
no embedding model. Explainable by design (returns the matched reason too).
"""
from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

from app.models.db_models import Classification

# Explicit batch/bulk signals.
_BULK_PATTERNS = [
    re.compile(r"\b(each|all|every)\s+of\s+(these|the\s+following)\b", re.IGNORECASE),
    re.compile(r"\b(these|the\s+following)\s+\d+\b", re.IGNORECASE),
    re.compile(r"\bfor\s+each\b", re.IGNORECASE),
    re.compile(r"\b(classify|translate|summar|extract|tag|label|rewrite)\w*\s+"
               r"(these|the\s+following|each)\b", re.IGNORECASE),
    re.compile(r"\bbatch\b", re.IGNORECASE),
]

# Multi-step / reasoning signals.
_COMPLEX_KEYWORDS = (
    "explain", "why", "how does", "how do", "compare", "contrast", "derive",
    "analyze", "analyse", "prove", "step-by-step", "step by step", "reasoning",
    "trade-off", "tradeoff", "design", "architect", "evaluate", "walk through",
    "pros and cons", "in detail", "describe how",
)

_COMPLEX_LEN = 600  # chars
_SIMPLE_LEN = 200


_TRUTHY_STRINGS = ("1", "true", "yes")


def _as_hints(metadata: Any) -> dict[str, Any]:
    """Normalize the metadata argument to a flat dict of hints.

    Accepts a ``ChatMetadata`` (the API path) or any plain mapping (callers that
    build hints directly, e.g. the eval runner and tests).
    """
    if metadata is None:
        return {}
    hints = getattr(metadata, "hints", None)
    if callable(hints):
        return hints()
    if isinstance(metadata, Mapping):
        return dict(metadata)
    return {}


def _is_true(value: Any) -> bool:
    """True for a real bool True, or for the legacy string spellings of it."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in _TRUTHY_STRINGS
    return value == 1


def classify(prompt: str, metadata: Any = None) -> tuple[Classification, str]:
    """Return (classification, human-readable reason)."""
    text = prompt.strip()
    lowered = text.lower()

    # 1. Explicit metadata hint wins.
    hints = _as_hints(metadata)
    if hints:
        hint = str(hints.get("category") or hints.get("classification") or "").lower()
        if hint in ("simple", "complex", "bulk"):
            return Classification(hint), f"metadata hint: {hint}"
        # Contract flag: a bool. The legacy `batch` key (and string spellings of
        # both) stay accepted so older callers keep routing the same way.
        if _is_true(hints.get("batch_hint")):
            return Classification.bulk, "metadata batch_hint"
        if _is_true(hints.get("batch")):
            return Classification.bulk, "metadata batch flag"

    # 2. Bulk patterns.
    for pat in _BULK_PATTERNS:
        if pat.search(lowered):
            return Classification.bulk, f"bulk pattern: {pat.pattern}"

    # 3. Complex: length or reasoning keywords.
    if len(text) >= _COMPLEX_LEN:
        return Classification.complex, f"length {len(text)} >= {_COMPLEX_LEN}"
    matched = [k for k in _COMPLEX_KEYWORDS if k in lowered]
    if matched:
        return Classification.complex, f"reasoning keyword(s): {', '.join(matched[:3])}"

    # 4. Default simple.
    return Classification.simple, "no complex/bulk signal"
