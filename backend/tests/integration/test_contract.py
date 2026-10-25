"""API-contract conformance tests.

One section per documented contract fix. These assert the *exact wire shape*
the frontend's schemas expect — field names, nesting, nullability and enum
values — not just HTTP 200s, because every regression fixed here was a 200 that
carried the wrong body.

Runs against the live docker-compose Postgres + Redis (same as
test_integration.py). Provider calls are avoided except where noted.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, text

from app.api.routes_admin import MAX_PAGE
from app.api.routes_chat import _fallback_info
from app.core.cache import semantic_cache
from app.db.session import async_session_maker
from app.eval.judge import SCORE_MAX, SCORE_MIN, _clamp
from app.main import app
from app.models.db_models import (
    CacheEntry,
    EvalResult,
    EvalRun,
    EvalRunStatus,
    ProviderName,
    QuotaLedger,
)
from app.providers.registry import all_provider_names

EXPECTED_PROVIDERS = {"groq", "cerebras", "gemini"}


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def eval_run_fixture():
    """A finished eval run with two judged items. Cleaned up afterwards."""
    run_id = uuid.uuid4()
    async with async_session_maker() as s:
        s.add(
            EvalRun(
                id=run_id,
                golden_set_path="/tmp/contract.json",
                provider="groq",
                num_prompts=2,
                threshold=3.0,
                status=EvalRunStatus.complete.value,
                mean_relevance=4.5,
                mean_coherence=4.0,
                mean_correctness=3.5,
                pass_rate=1.0,
            )
        )
        await s.flush()
        for i in range(2):
            s.add(
                EvalResult(
                    run_id=run_id,
                    prompt=f"contract prompt {i}",
                    expected_category="simple",
                    response_text="resp",
                    generated_by="groq",
                    judge_provider="gemini",
                    cross_provider=True,
                    relevance=5,
                    coherence=4,
                    correctness=None,
                )
            )
        await s.commit()
    yield run_id
    async with async_session_maker() as s:
        await s.execute(delete(EvalResult).where(EvalResult.run_id == run_id))
        await s.execute(delete(EvalRun).where(EvalRun.id == run_id))
        await s.commit()


# ── Provider set: Ollama is gone everywhere a provider is enumerated ────────
def test_provider_registry_has_no_ollama():
    assert set(all_provider_names()) == EXPECTED_PROVIDERS
    assert {p.value for p in ProviderName} == EXPECTED_PROVIDERS


# ── Fix 1: GET /v1/health/providers is a flat {provider: bool} map ──────────
async def test_health_providers_is_flat_bool_map(client):
    r = await client.get("/v1/health/providers", timeout=60)
    assert r.status_code == 200
    body = r.json()
    # No wrapper key.
    assert "providers" not in body
    assert set(body) == EXPECTED_PROVIDERS
    assert all(isinstance(v, bool) for v in body.values())


# ── Fix 2: GET /v1/admin/providers exposes rate_limit_remaining + error_count ──
async def test_admin_providers_contract_fields(client):
    r = await client.get("/v1/admin/providers")
    assert r.status_code == 200
    rows = r.json()
    assert {row["provider"] for row in rows} == EXPECTED_PROVIDERS
    for row in rows:
        assert isinstance(row["rate_limit_remaining"], int)
        assert isinstance(row["error_count"], int)
        assert row["error_count"] >= 0
        assert isinstance(row["circuit_state"], str)
        # Additive fields kept for the capacity gauges — must not have replaced
        # the contract fields.
        assert "rate_limit_capacity" in row
        assert "rate_limit_available" in row


async def test_admin_providers_error_count_tracks_breaker(client):
    from app.core.resilience import circuit_breaker as cb

    await cb.reset("gemini")
    await cb.record_failure("gemini", "contract-test")
    await cb.record_failure("gemini", "contract-test")
    try:
        rows = (await client.get("/v1/admin/providers")).json()
        gemini = next(r for r in rows if r["provider"] == "gemini")
        assert gemini["error_count"] == 2
    finally:
        await cb.reset("gemini")


async def test_admin_providers_rate_limit_remaining_is_floored(client):
    from app.core.resilience import rate_limiter as rl

    await rl.reset("groq")
    try:
        rows = (await client.get("/v1/admin/providers")).json()
        groq = next(r for r in rows if r["provider"] == "groq")
        # A fresh bucket is full: remaining is the floor of the float reading.
        assert groq["rate_limit_remaining"] == int(groq["rate_limit_available"])
    finally:
        await rl.reset("groq")


# ── Fix 3: GET /v1/admin/cache/stats uses hit_rate ──────────────────────────
async def test_cache_stats_uses_hit_rate(client):
    r = await client.get("/v1/admin/cache/stats")
    assert r.status_code == 200
    body = r.json()
    assert "request_hit_rate" not in body
    assert isinstance(body["hit_rate"], float)
    assert 0.0 <= body["hit_rate"] <= 1.0
    assert isinstance(body["total_entries"], int)
    assert isinstance(body["avg_hit_count"], float)


# ── Fix 4: eval status enum + nested aggregates + scores[].provider ─────────
def test_eval_status_enum_value_is_complete():
    """The contract's terminal-success value — 'complete', not 'completed'."""
    assert EvalRunStatus.complete.value == "complete"
    assert "completed" not in {s.value for s in EvalRunStatus}


async def test_eval_run_default_status_is_complete():
    """The DB default must not reintroduce 'completed' behind the app's back."""
    run_id = uuid.uuid4()
    async with async_session_maker() as s:
        s.add(
            EvalRun(id=run_id, golden_set_path="/tmp/x.json", provider="groq",
                    num_prompts=0, threshold=0.0)
        )
        await s.commit()
    try:
        async with async_session_maker() as s:
            status = (await s.execute(
                text("SELECT status FROM eval_runs WHERE id = :id"), {"id": str(run_id)}
            )).scalar()
        assert status == "complete"
    finally:
        async with async_session_maker() as s:
            await s.execute(delete(EvalRun).where(EvalRun.id == run_id))
            await s.commit()


async def test_eval_runs_list_status_enum(client, eval_run_fixture):
    r = await client.get("/v1/eval/runs", params={"limit": MAX_PAGE})
    assert r.status_code == 200
    items = r.json()["items"]
    row = next(i for i in items if i["run_id"] == str(eval_run_fixture))
    assert row["status"] == "complete"
    assert all(i["status"] != "completed" for i in items)


async def test_eval_run_detail_shape(client, eval_run_fixture):
    r = await client.get(f"/v1/eval/runs/{eval_run_fixture}")
    assert r.status_code == 200
    body = r.json()

    # Nested aggregates, not flat means.
    assert "results" not in body
    assert "mean_relevance" not in body
    assert body["aggregates"] == {
        "relevance_mean": 4.5,
        "coherence_mean": 4.0,
        "correctness_mean": 3.5,
        "pass_rate": 1.0,
    }
    assert body["status"] == "complete"

    # scores[] — 'provider' is the generating provider, not 'generated_by'.
    assert len(body["scores"]) == 2
    for item in body["scores"]:
        assert "generated_by" not in item
        assert item["provider"] == "groq"
        assert isinstance(item["prompt"], str)
        assert item["relevance"] == 5
        assert item["coherence"] == 4
        assert item["correctness"] is None  # nullable, not coerced to 0


def test_judge_scale_is_1_to_5_nullable_int():
    """Confirmed canonical scale: integers 1..5 inclusive, or null.

    NOT a 0-1 float. A judge reporting 0 (or anything below the floor) is
    clamped up to SCORE_MIN; unparseable values stay null.
    """
    assert (SCORE_MIN, SCORE_MAX) == (1, 5)
    assert _clamp(0) == 1
    assert _clamp(-3) == 1
    assert _clamp(9) == 5
    assert _clamp(3) == 3
    assert _clamp(None) is None
    assert _clamp("nonsense") is None


def test_eval_judge_never_targets_ollama():
    from app.eval import judge, runner

    assert runner.DEFAULT_PROVIDER in EXPECTED_PROVIDERS
    assert set(judge._select_candidates("groq")) == EXPECTED_PROVIDERS - {"groq"}


# ── Fix 5: POST /v1/chat -> request_id + fallback_info ─────────────────────
def test_fallback_info_is_null_when_nothing_skipped():
    """Contract: null when nothing was skipped — never [] and never omitted."""
    assert _fallback_info([]) is None
    info = _fallback_info([{"provider": "groq", "reason": "rate_limited"}])
    assert info is not None
    assert info.model_dump() == {"skipped": [{"provider": "groq", "reason": "rate_limited"}]}


async def test_chat_response_contract(client):
    """Makes one real provider call (same as the lifecycle integration test)."""
    r = await client.post(
        "/v1/chat", json={"prompt": f"contract check {uuid.uuid4()}: reply 'ok'"},
        timeout=90,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "id" not in body
    assert "routing_trace" not in body
    uuid.UUID(body["request_id"])  # parseable UUID
    # Present but nullable — the key must exist either way.
    assert "fallback_info" in body
    assert body["fallback_info"] is None or isinstance(body["fallback_info"], dict)
    if body["fallback_info"] is not None:
        for entry in body["fallback_info"]["skipped"]:
            assert set(entry) == {"provider", "reason"}


async def test_chat_request_id_matches_persisted_row(client):
    r = await client.post(
        "/v1/chat", json={"prompt": f"id join check {uuid.uuid4()}: reply 'ok'"},
        timeout=90,
    )
    assert r.status_code == 200, r.text
    request_id = r.json()["request_id"]
    async with async_session_maker() as s:
        found = (await s.execute(
            text("SELECT count(*) FROM requests WHERE id = :id"), {"id": request_id}
        )).scalar()
    assert found == 1


# ── Fix 9: a cache hit reports the ORIGINATING provider, never "cache" ─────
@pytest.fixture
async def seeded_cache_entry():
    """A cache row whose generator is known, so a hit has an expected answer.

    Written directly (not via a provider call) so the assertion is about the
    read path only: hit -> provider_used == the provider that generated it.
    """
    prompt = f"cache provider contract {uuid.uuid4()}"
    await semantic_cache.store(prompt, "seeded response", 3600, "cerebras")
    yield prompt, "cerebras"
    async with async_session_maker() as s:
        await s.execute(
            delete(CacheEntry).where(CacheEntry.prompt_hash == semantic_cache._hash(prompt))
        )
        await s.commit()


async def test_cache_hit_returns_originating_provider(client, seeded_cache_entry):
    prompt, origin = seeded_cache_entry
    r = await client.post("/v1/chat", json={"prompt": prompt}, timeout=60)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "cached"
    # The bug: this used to be the synthetic string "cache".
    assert body["provider_used"] != "cache"
    assert body["provider_used"] == origin
    assert body["provider_used"] in EXPECTED_PROVIDERS
    # Contract: a cache hit never routes, so there is no fallback trace.
    assert body["fallback_info"] is None


async def test_cache_hit_persists_originating_provider(client, seeded_cache_entry):
    """The `requests` row must agree with the response, not say "cache"."""
    prompt, origin = seeded_cache_entry
    r = await client.post("/v1/chat", json={"prompt": prompt}, timeout=60)
    assert r.status_code == 200, r.text
    async with async_session_maker() as s:
        stored = (await s.execute(
            text("SELECT provider_used, status FROM requests WHERE id = :id"),
            {"id": r.json()["request_id"]},
        )).first()
    assert stored == (origin, "cached")


async def test_cache_store_persists_provider():
    """store() round-trips the generator; lookup() surfaces it."""
    prompt = f"store provider round trip {uuid.uuid4()}"
    await semantic_cache.store(prompt, "resp", 3600, "gemini")
    try:
        entry = await semantic_cache.lookup(prompt)
        assert entry is not None
        assert entry.provider == "gemini"
    finally:
        async with async_session_maker() as s:
            await s.execute(
                delete(CacheEntry).where(
                    CacheEntry.prompt_hash == semantic_cache._hash(prompt)
                )
            )
            await s.commit()


async def test_fresh_then_cached_provider_matches(client):
    """End-to-end: the cached hit reports exactly what the fresh call reported.

    Makes one real provider call, then waits for the (asynchronous, arq-queued)
    cache write to land before re-asking.
    """
    prompt = f"fresh vs cached {uuid.uuid4()}: reply 'ok'"
    first = await client.post("/v1/chat", json={"prompt": prompt}, timeout=90)
    assert first.status_code == 200, first.text
    fresh = first.json()
    assert fresh["status"] == "success"
    assert fresh["provider_used"] in EXPECTED_PROVIDERS

    try:
        # The cache write is fire-and-forget on the cache-worker queue.
        for _ in range(60):
            if await semantic_cache.lookup(prompt) is not None:
                break
            await asyncio.sleep(0.5)
        else:
            pytest.fail("cache write never landed — cache-worker not running?")

        second = await client.post("/v1/chat", json={"prompt": prompt}, timeout=90)
        assert second.status_code == 200, second.text
        cached = second.json()
        assert cached["status"] == "cached"
        assert cached["provider_used"] == fresh["provider_used"]
    finally:
        async with async_session_maker() as s:
            await s.execute(
                delete(CacheEntry).where(
                    CacheEntry.prompt_hash == semantic_cache._hash(prompt)
                )
            )
            await s.commit()


# ── Fix 10: metadata.batch_hint is a bool and actually steers routing ──────
def test_batch_hint_is_declared_bool_in_schema():
    from app.models.schemas import ChatMetadata

    field = ChatMetadata.model_fields["batch_hint"]
    assert field.annotation == (bool | None)
    assert not field.is_required()
    # Unknown hint keys must still pass — the contract's metadata shape is open.
    assert ChatMetadata(batch_hint=True, tenant="acme").hints()["tenant"] == "acme"


async def test_batch_hint_bool_is_in_openapi(client):
    schema = (await client.get("/openapi.json")).json()
    meta = schema["components"]["schemas"]["ChatMetadata"]["properties"]["batch_hint"]
    # Optional bool serializes as anyOf[boolean, null].
    types = {s.get("type") for s in meta.get("anyOf", [meta])}
    assert "boolean" in types, meta


def test_batch_hint_true_classifies_bulk():
    """The flag must reach the classifier, not just pass validation."""
    from app.core.router.classifier import classify
    from app.models.db_models import Classification
    from app.models.schemas import ChatMetadata

    prompt = "what is the capital of France"
    plain, _ = classify(prompt, None)
    assert plain is Classification.simple, "control prompt must not be bulk on its own"

    hinted, reason = classify(prompt, ChatMetadata(batch_hint=True))
    assert hinted is Classification.bulk
    assert "batch_hint" in reason


def test_batch_hint_false_and_absent_do_not_force_bulk():
    from app.core.router.classifier import classify
    from app.models.db_models import Classification
    from app.models.schemas import ChatMetadata

    prompt = "what is the capital of France"
    assert classify(prompt, ChatMetadata(batch_hint=False))[0] is Classification.simple
    assert classify(prompt, ChatMetadata())[0] is Classification.simple


def test_bulk_classification_routes_to_throughput_tier():
    """Being classified bulk is only useful if bulk has its own provider order."""
    from app.core.router import policy
    from app.models.db_models import Classification

    assert policy.provider_order(Classification.bulk)[0] == "cerebras"
    assert (policy.provider_order(Classification.bulk)
            != policy.provider_order(Classification.simple))


async def test_chat_accepts_batch_hint_bool(client):
    """Regression: this returned 422 'Input should be a valid string'."""
    r = await client.post(
        "/v1/chat",
        json={"prompt": f"batch hint check {uuid.uuid4()}: reply 'ok'",
              "metadata": {"batch_hint": True}},
        timeout=90,
    )
    assert r.status_code == 200, r.text
    assert r.json()["classification"] == "bulk"


async def test_chat_rejects_non_bool_batch_hint(client):
    """Bool means bool — an arbitrary string is still a validation error."""
    r = await client.post(
        "/v1/chat",
        json={"prompt": "hello", "metadata": {"batch_hint": "maybe"}},
    )
    assert r.status_code == 422
    loc = r.json()["error"]["detail"]["errors"][0]["loc"]
    assert loc[-1] == "batch_hint"


def test_chat_routing_has_no_local_tier():
    """No offline/local provider remains in any policy chain."""
    from app.core.router import policy
    from app.models.db_models import Classification

    for classification in Classification:
        order = policy.provider_order(classification)
        assert set(order) == EXPECTED_PROVIDERS
        assert policy.last_resort(classification) in EXPECTED_PROVIDERS


# ── Fix 6: quota/history date-range filtering + documented page cap ─────────
@pytest.fixture
async def quota_rows():
    """Three two-day groq ledger periods.

    old:    [now-10d, now-8d]   — entirely in the past
    middle: [now-5d,  now-3d]
    active: [now-1d,  now+1d]   — straddles now, so it also shows in /quota
    """
    now = datetime.now(UTC)
    starts = [now - timedelta(days=d) for d in (10, 5, 1)]
    async with async_session_maker() as s:
        for start in starts:
            s.add(
                QuotaLedger(
                    provider=ProviderName.groq,
                    period_start=start,
                    period_end=start + timedelta(days=2),
                    tokens_used=100,
                    token_budget=1000,
                )
            )
        await s.commit()
    yield starts
    async with async_session_maker() as s:
        for start in starts:
            await s.execute(
                delete(QuotaLedger).where(QuotaLedger.period_start == start)
            )
        await s.commit()


async def _history_starts(client, **params) -> set[datetime]:
    """period_start values returned by quota/history, as datetimes."""
    r = await client.get("/v1/admin/quota/history",
                         params={"provider": "groq", "limit": MAX_PAGE, **params})
    assert r.status_code == 200, r.text
    return {datetime.fromisoformat(i["period_start"]) for i in r.json()["items"]}


async def test_quota_history_filters_by_date_range(client, quota_rows):
    old, middle, active = quota_rows
    now = datetime.now(UTC)

    unfiltered = await _history_starts(client)
    assert {old, middle, active} <= unfiltered

    # Window [now-6d, now] overlaps `middle` and `active` but not `old`.
    filtered = await _history_starts(
        client, start=(now - timedelta(days=6)).isoformat(), end=now.isoformat()
    )
    assert middle in filtered
    assert active in filtered
    assert old not in filtered, "start/end are being ignored"


async def test_quota_history_start_only_and_end_only(client, quota_rows):
    old, middle, active = quota_rows
    now = datetime.now(UTC)

    # start only: keeps periods ending at/after the bound.
    only_start = await _history_starts(
        client, start=(now - timedelta(days=2)).isoformat()
    )
    assert active in only_start
    assert old not in only_start
    assert middle not in only_start

    # end only: keeps periods starting at/before the bound.
    only_end = await _history_starts(client, end=(now - timedelta(days=8)).isoformat())
    assert old in only_end
    assert middle not in only_end
    assert active not in only_end


async def test_quota_history_rejects_inverted_range(client):
    now = datetime.now(UTC)
    r = await client.get("/v1/admin/quota/history", params={
        "start": now.isoformat(),
        "end": (now - timedelta(days=1)).isoformat(),
    })
    assert r.status_code == 422
    assert isinstance(r.json()["error"]["detail"], dict)


async def test_quota_history_rejects_unparseable_date(client):
    """Params are declared, so bad input fails loudly instead of being ignored."""
    r = await client.get("/v1/admin/quota/history", params={"start": "not-a-date"})
    assert r.status_code == 422


async def test_page_limit_cap_is_in_openapi(client):
    """MAX_PAGE must be discoverable from the schema, not via a surprise 422."""
    schema = (await client.get("/openapi.json")).json()
    for path in ("/v1/admin/quota/history", "/v1/eval/runs"):
        params = schema["paths"][path]["get"]["parameters"]
        limit = next(p for p in params if p["name"] == "limit")
        assert limit["schema"]["maximum"] == MAX_PAGE
        assert str(MAX_PAGE) in limit.get("description", "")

    # And the cap is actually enforced.
    r = await client.get("/v1/admin/quota/history", params={"limit": MAX_PAGE + 1})
    assert r.status_code == 422


# ── Fix 7: error envelope detail is ALWAYS an object ────────────────────────
@pytest.mark.parametrize(
    ("method", "path", "json_body", "expected_status"),
    [
        ("post", "/v1/chat", {}, 422),                              # validation -> list
        ("post", "/v1/chat", {"prompt": ""}, 422),                  # constraint  -> list
        ("get", f"/v1/eval/runs/{uuid.uuid4()}", None, 404),        # str detail
        ("get", "/v1/admin/quota/history?limit=99999", None, 422),  # query validation
        ("get", "/v1/nope", None, 404),                             # no detail at all
    ],
)
async def test_error_envelope_detail_is_object(client, method, path, json_body,
                                               expected_status):
    r = await getattr(client, method)(path, **({"json": json_body} if json_body is not None else {}))
    assert r.status_code == expected_status
    err = r.json()["error"]
    assert set(err) >= {"type", "message", "detail"}
    assert isinstance(err["type"], str)
    assert isinstance(err["message"], str)
    assert isinstance(err["detail"], dict), f"detail must be an object, got {type(err['detail'])}"


async def test_validation_errors_nested_under_detail_errors(client):
    """The list of pydantic errors is preserved — just wrapped in an object."""
    r = await client.post("/v1/chat", json={})
    detail = r.json()["error"]["detail"]
    assert isinstance(detail, dict)
    assert isinstance(detail["errors"], list)
    assert detail["errors"][0]["loc"] == ["body", "prompt"]


async def test_unhandled_exception_uses_the_envelope(monkeypatch):
    """A crash must not fall back to Starlette's plain-text 500."""
    from app.api import routes_admin

    async def boom(*_args, **_kwargs):
        raise RuntimeError("kaboom")

    monkeypatch.setattr(routes_admin.circuit_breaker, "get_state", boom)
    # raise_app_exceptions=False so the transport returns the handler's response
    # instead of re-raising, i.e. exactly what a real client would receive.
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.get("/v1/admin/providers")
    assert r.status_code == 500
    err = r.json()["error"]
    assert err["type"] == "internal_error"
    assert err["detail"] == {}
    assert "kaboom" not in r.text  # internals stay in the log, not the response


async def test_inverted_quota_range_is_typed_validation_error(client):
    from datetime import UTC, datetime, timedelta

    now = datetime.now(UTC)
    r = await client.get("/v1/admin/quota/history", params={
        "start": now.isoformat(), "end": (now - timedelta(days=1)).isoformat(),
    })
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["type"] == "validation_error"
    assert isinstance(err["detail"], dict)


# ── Fix 8: GET /v1/admin/quota keeps utilization, drops ollama ──────────────
async def test_quota_rows_have_utilization_and_no_ollama(client, quota_rows):
    r = await client.get("/v1/admin/quota")
    assert r.status_code == 200
    rows = r.json()
    assert rows, "fixture's active period should be listed"
    for row in rows:
        assert isinstance(row["utilization"], float)
        assert row["provider"] in EXPECTED_PROVIDERS


# ── CORS ───────────────────────────────────────────────────────────────────
async def test_cors_preflight_allows_configured_origin(client):
    from app.config import settings

    origin = settings.cors_origin_list[0]
    r = await client.options("/v1/health", headers={
        "Origin": origin,
        "Access-Control-Request-Method": "GET",
    })
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == origin


async def test_cors_header_on_actual_request(client):
    from app.config import settings

    origin = settings.cors_origin_list[0]
    r = await client.get("/v1/health", headers={"Origin": origin})
    assert r.headers["access-control-allow-origin"] == origin


def test_cors_origins_come_from_env_not_hardcoded():
    from app.config import Settings

    s = Settings(cors_origins="https://a.example,https://b.example")
    assert s.cors_origin_list == ["https://a.example", "https://b.example"]
