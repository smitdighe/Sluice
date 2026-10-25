"""Cross-provider LLM-as-judge.

Selection strategy: **round-robin exclude-generator**. Candidates are the
registered providers minus ``generated_by``, cycled deterministically by a module
counter so load spreads across judges and no judge scores its own output (avoids
self-preference bias). The first candidate whose live call succeeds is used.

If no cross-provider candidate is reachable (e.g. only one provider has a key
configured), we fall back to the generator's provider and set
``cross_provider=False`` so the bias caveat is recorded, never hidden.
"""
from __future__ import annotations

import json
import re
from itertools import count

from pydantic import BaseModel, Field

from app.providers.base import ProviderError
from app.providers.registry import all_provider_names, get_adapter

#: Canonical judge score scale — integers 1..5 inclusive, or null when the
#: dimension could not be scored. This is the API contract's scale for
#: relevance/coherence/correctness; do not reinterpret it as a 0–1 float.
SCORE_MIN = 1
SCORE_MAX = 5

_JUDGE_PROMPT = """You are an impartial evaluator. Score the ASSISTANT RESPONSE to the USER PROMPT.
Rate each 1-5 (integers only, where 1 is worst and 5 is best):
- relevance: does it address the prompt?
- coherence: is it clear and well-structured?
- correctness: is it factually right?{reference_note}

USER PROMPT:
{prompt}

ASSISTANT RESPONSE:
{response}

Reply with ONLY a JSON object, no prose:
{{"relevance": <int>, "coherence": <int>, "correctness": <int>}}"""

_counter = count()


class JudgeScore(BaseModel):
    """Scores are integers on the 1..5 scale (SCORE_MIN..SCORE_MAX) or None."""

    relevance: int | None = Field(None, ge=SCORE_MIN, le=SCORE_MAX)
    coherence: int | None = Field(None, ge=SCORE_MIN, le=SCORE_MAX)
    correctness: int | None = Field(None, ge=SCORE_MIN, le=SCORE_MAX)
    raw_judge_output: str
    judge_provider: str
    cross_provider: bool


def _select_candidates(generated_by: str) -> list[str]:
    others = [n for n in all_provider_names() if n != generated_by]
    if not others:
        return []
    start = next(_counter) % len(others)
    return others[start:] + others[:start]


def _parse(raw: str) -> tuple[int | None, int | None, int | None]:
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if match:
        try:
            data = json.loads(match.group(0))
            return (
                _clamp(data.get("relevance")),
                _clamp(data.get("coherence")),
                _clamp(data.get("correctness")),
            )
        except (json.JSONDecodeError, TypeError):
            pass
    return None, None, None


def _clamp(v) -> int | None:
    """Coerce a judge-reported score into SCORE_MIN..SCORE_MAX, else None."""
    try:
        return max(SCORE_MIN, min(SCORE_MAX, int(v)))
    except (TypeError, ValueError):
        return None


async def judge_response(
    prompt: str,
    response: str,
    generated_by: str,
    reference: str | None = None,
) -> JudgeScore:
    reference_note = (
        f"\nReference answer for correctness: {reference}" if reference else
        "\nNo reference given — judge correctness on general knowledge alone."
    )
    judge_prompt = _JUDGE_PROMPT.format(
        prompt=prompt, response=response, reference_note=reference_note
    )

    candidates = _select_candidates(generated_by)
    last_error = ""
    for provider in candidates:
        try:
            result = await get_adapter(provider).complete(judge_prompt, max_tokens=200)
        except ProviderError as exc:
            last_error = str(exc)
            continue
        rel, coh, cor = _parse(result.text)
        if reference is None:
            cor = None
        return JudgeScore(
            relevance=rel,
            coherence=coh,
            correctness=cor,
            raw_judge_output=result.text,
            judge_provider=provider,
            cross_provider=True,
        )

    # Fallback: no cross-provider judge available — use the generator, flagged.
    try:
        result = await get_adapter(generated_by).complete(judge_prompt, max_tokens=200)
    except ProviderError as exc:
        raise ProviderError("judge", f"no judge available: {last_error or exc}") from exc
    rel, coh, cor = _parse(result.text)
    if reference is None:
        cor = None
    return JudgeScore(
        relevance=rel,
        coherence=coh,
        correctness=cor,
        raw_judge_output=result.text,
        judge_provider=generated_by,
        cross_provider=False,
    )
