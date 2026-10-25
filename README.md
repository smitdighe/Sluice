<div align="center">

<pre>
███████╗ ██╗      ██╗   ██╗ ██╗  ██████╗ ███████╗
██╔════╝ ██║      ██║   ██║ ██║ ██╔════╝ ██╔════╝
███████╗ ██║      ██║   ██║ ██║ ██║      █████╗  
╚════██║ ██║      ██║   ██║ ██║ ██║      ██╔══╝  
███████║ ███████╗ ╚██████╔╝ ██║ ╚██████╗ ███████╗
╚══════╝ ╚══════╝  ╚═════╝  ╚═╝  ╚═════╝ ╚══════╝
</pre>

*A self-hosted gateway that routes every prompt to the right free-tier model, caches what it can, and never silently degrades.*

</div>

<div align="center">

Sluice sits between an application and three free-tier LLM providers — Groq, Cerebras, and
Gemini. Every prompt is classified (simple / complex / bulk) by a deterministic, zero-network
rule engine, checked against a semantic cache backed by pgvector, and routed through a
policy-ordered provider chain that honors a per-provider circuit breaker and Redis token-bucket
rate limiter. A failed call fails over to the next tier automatically; a fully broken fleet
returns an explicit `503`, never a quietly wrong answer. Every stage of that pipeline is
published to a live SSE trace stream, rendered on a dashboard as packets moving across an
actual circuit diagram.

**It never lies about its own health.** A response's `provider_used` and `fallback_info` are
always the real values, not a synthetic default — and when every tier is exhausted, the API
says so explicitly instead of returning a degraded answer with a 200. That guarantee, plus a
cross-provider LLM-judge eval harness and a Locust-driven chaos-testing suite, is what this
project is actually about: **teams who want multi-model orchestration and cost control without
paying for a managed LLM gateway.**

</div>

---

## 🔍 How It Works

```
  POST /v1/chat  { prompt, metadata? }
         │
         ▼
  classify(prompt, metadata)              deterministic regex/keyword rules, no network,
         │                                 no embedding call — routes_chat.py + classifier.py
         ├─► simple | complex | bulk  (+ human-readable reason)
         ▼
  SSE: stage=classify ─────────────────────────────────────────────────► trace stream
         │
         ▼
  semantic_cache.lookup(prompt)
         │
         ├─ exact prompt_hash hit ──► HIT, NO embedding computed ──► hit_count++, return
         │                                                            (status: cached)
         │ miss
         ▼
  embed(prompt)  all-MiniLM-L6-v2, 384-dim, local, zero API cost
         │
         ▼
  pgvector HNSW cosine search, similarity ≥ 0.92 ──► HIT ──► same as above
         │ miss
         ▼
  SSE: stage=cache result=miss ────────────────────────────────────────► trace stream
         │
         ▼
  ┌─ select_provider(classification, exclude=tried) ─────────────────┐
  │  policy.provider_order(classification)   e.g. simple: groq → cerebras → gemini │
  │  for each tier:                                                   │
  │    rate_limiter.acquire(provider)   Redis Lua token bucket        │
  │    circuit_breaker.is_available(provider)   Redis Lua, atomic     │
  │       half-open "single trial" claim                              │
  │  none available ──► force the last-resort tier (forced_fallback)  │
  └────────────────────────────────────────────────────────────────────┘
         │
         ▼
  SSE: stage=route selected=<provider> skipped=[...] forced_fallback=<bool>
         │
         ▼
  call_with_retry(adapter, prompt)   up to 3 attempts, exponential backoff + jitter
         │                            retries: 408/429/500/502/503/504 — NOT 4xx auth/validation
         │                            a 429 also drains the local rate-limit bucket
         ├─ success ──► circuit_breaker.record_success(provider)
         │              SSE: stage=call outcome=success latency_ms=<n>
         │              enqueue_cache_write(prompt, response, ttl, provider)  ── async, arq
         │              persist Request{status: success}
         │              SSE: stage=complete
         │              ▼
         │            200 { response, provider_used, classification, fallback_info }
         │
         └─ ProviderError ──► circuit_breaker.record_failure(provider, error)
                    SSE: stage=call outcome=failed error=<msg>
                    │
                    ├─ forced_fallback was true ──► STOP. every cloud tier is down.
                    │                                persist Request{status: error}
                    │                                503 { type: no_route_available, skipped, trace }
                    │
                    └─ tier remained ──► loop back to select_provider, excluding this provider
                                          (the next iteration's `route` event IS the fallback —
                                           there is no separate "fallback" SSE stage today)
```

What makes this a system rather than a demo is where the guarantees sit. Every state
transition that matters — circuit-breaker open/half-open/closed, the token-bucket
decrement — runs inside a single Redis Lua script, so the half-open state's "exactly one
concurrent request becomes the recovery trial" guarantee holds under real concurrency, not
just in the happy path. `rate_limiter.acquire()` is deliberately called *before*
`circuit_breaker.is_available()`: `is_available` atomically claims the half-open trial, so
claiming it and then bailing on a rate-limit miss would strand the breaker half-open with a
wasted trial — occasionally spending a rate token on a broken provider is cheap and
self-healing; a stuck trial is not. The semantic cache's `store()` serializes concurrent
writers for the same prompt on a Postgres advisory lock and re-checks for an existing entry
under that lock, with a `UNIQUE` constraint on the prompt hash as the hard backstop if two
writers ever slip past it anyway.

---

## ✨ Features

<table>
<tr>
<td width="33%" valign="top">

### 🔀 Classify-then-route
A pure, explainable classifier (regex + keyword heuristics, no network call) tags every
prompt `simple` / `complex` / `bulk` and returns *why*. A data-only policy table then maps
each classification to an ordered provider chain — Groq first for latency-sensitive simple
prompts, Gemini first for complex reasoning, Cerebras first for bulk throughput.

</td>
<td width="33%" valign="top">

### 🧠 Semantic cache, cheap by default
`all-MiniLM-L6-v2` embeddings + pgvector HNSW cosine search, threshold `0.92`. An exact
repeat prompt is served from a hash index **without computing an embedding at all** — the
embedding model is the dominant per-request cost, so the common case skips it entirely.

</td>
<td width="33%" valign="top">

### ⚡ Circuit breaker + rate limiter
Per-provider `closed → open → half_open` breaker and a token-bucket rate limiter, both
Redis-backed and both driven entirely by atomic Lua scripts — no read-then-write race is
possible even across multiple API/worker processes.

</td>
</tr>
<tr>
<td width="33%" valign="top">

### 🚨 Never silently degrades
When every provider tier is circuit-broken or rate-limited, the router still forces one
call through the least-preferred tier (doubling as a recovery probe). If that also fails,
the API returns `503 no_route_available` with the full skip trace — never a quiet 200 with
a worse answer.

</td>
<td width="33%" valign="top">

### ⚖️ Cross-provider LLM-judge eval
A golden-set runner scores generated responses 1–5 on relevance, coherence, and
correctness, using a **different** provider than the one that generated the response
(round-robin, generator excluded) to avoid self-preference bias. Falls back to
same-provider judging only when no other provider is reachable, and flags it
(`cross_provider: false`) rather than hiding it.

</td>
<td width="33%" valign="top">

### 🧪 Chaos-tested resilience
A `ChaosAdapter` wraps any provider adapter and injects `timeout` / `http_5xx` / `http_429`
/ `conn_refused` faults on command via a Redis flag — invisible to the adapters themselves,
and completely absent from the call path when disabled. A Locust suite drives realistic
classifier-shaped traffic through it to measure p50/p95/p99 under partial outage.

</td>
</tr>
</table>

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| API | FastAPI + Uvicorn (async) | `/v1/chat`, `/v1/health`, `/v1/eval`, `/v1/admin`, `/v1/trace` |
| Database | Postgres 17 + `pgvector` (`pgvector/pgvector:pg17`) | Requests, cache entries + embeddings (HNSW cosine), quota, eval runs |
| ORM / migrations | SQLAlchemy 2 (async) + Alembic | 6 linear migrations, incl. dropping the retired Ollama provider |
| Cache / coordination | Redis 7 | Circuit-breaker state, rate-limit buckets, chaos fault flags, trace pub/sub |
| Job queue | `arq` — 3 independent worker pools on the same Redis | Cache writes, eval runs, cron maintenance (no Celery, no second broker) |
| Embeddings | `fastembed` (ONNX Runtime) — `all-MiniLM-L6-v2` (384-dim) | Local, zero-cost semantic cache matching; no torch, ~200MB resident |
| Providers | `groq`, `cerebras-cloud-sdk`, `google-genai` | Groq `llama-3.1-8b-instant`, Cerebras `llama3.1-8b`, Gemini `gemini-flash-latest` |
| Observability (infra) | Langfuse 3 (web + worker) on ClickHouse + MinIO, OpenTelemetry SDK/OTLP | Deployed via `docker-compose`; see note below |
| Load / chaos testing | Locust | `chaos/locustfile.py` — real classifier-weighted traffic |
| Validation | Pydantic v2 + `pydantic-settings` | API contracts, env-driven settings |
| Tests | pytest + pytest-asyncio | Contract conformance + integration, against live Postgres/Redis |
| Frontend | React 19 + TypeScript + Vite 8 | Dashboard SPA |
| Data fetching | TanStack Query 5 | Polling, mutations, per-feature query-key hierarchies |
| Client state | Zustand 5 | Live trace store (SSE ingest, eviction/sweep), shell UI state |
| Styling | Tailwind CSS 4 (`@tailwindcss/vite`) + Framer Motion 12 | Design tokens, circuit-canvas motion |
| Charts | Recharts 3 | Quota history, eval score distributions |
| Validation | Zod 4 | Runtime contract for every API response — the single source of frontend types |
| Frontend tests | Vitest 4 | Store reducers, trace-frame normalization, contrast ratios |

**Stack notes, verified against source (not the historical project docs):**
- **Ollama is fully retired.** A dedicated migration, `b71c4a0d9e52_drop_ollama_provider.py`,
  removes it from the `provider_name` enum. `app/providers/registry.py` wires exactly three
  adapters — `groq`, `cerebras`, `gemini` — and a frontend code comment notes the provider grid
  was cut from four columns to three "now that Ollama is gone."
- **Langfuse and OpenTelemetry are infrastructure, not yet instrumentation.** Both are real
  dependencies (`pyproject.toml`) with a full self-hosted Langfuse stack in `docker-compose.yml`
  (Postgres, ClickHouse, MinIO, `langfuse-web`, `langfuse-worker`) and matching settings in
  `app/config.py` / `.env.example` (`LANGFUSE_*`, `OTEL_EXPORTER_OTLP_ENDPOINT`). No application
  code calls the Langfuse or OTel SDKs yet — today's live observability is the custom Redis
  pub/sub trace bus (`app/core/trace.py`) streamed over SSE. Wiring provider calls through
  Langfuse/OTel is tracked under Future Improvements.

---

## 📁 Project Structure

```
Sluice/
├── backend/
│   ├── alembic/
│   │   └── versions/                 # 6 migrations: initial schema → cache/eval tables →
│   │                                 #   drop Ollama provider → eval run status (×2) → cache provider
│   ├── app/
│   │   ├── api/
│   │   │   ├── routes_chat.py        # POST /v1/chat — the full classify→cache→route→call→complete lifecycle
│   │   │   ├── routes_health.py      # liveness + concurrent per-provider health sweep
│   │   │   ├── routes_eval.py        # enqueue an eval run; list/detail paginated views
│   │   │   ├── routes_admin.py       # quota ledger, provider circuit/rate state, cache stats
│   │   │   └── routes_trace.py       # GET /v1/trace/stream — SSE fan-out over Redis pub/sub
│   │   ├── chaos/
│   │   │   └── fault_injection.py    # ChaosAdapter — wraps any adapter, injects faults from Redis
│   │   ├── core/
│   │   │   ├── cache/
│   │   │   │   ├── embedder.py       # all-MiniLM-L6-v2 singleton, loaded once at import
│   │   │   │   ├── semantic_cache.py # lookup()/store() — exact-hash fast path + pgvector search
│   │   │   │   └── invalidation.py   # TTL purge (called by the maintenance worker)
│   │   │   ├── resilience/
│   │   │   │   ├── circuit_breaker.py # closed/open/half_open — Lua-atomic, Redis-persisted
│   │   │   │   ├── rate_limiter.py    # Lua token bucket, one per provider
│   │   │   │   ├── retry.py           # backoff + jitter, retryable-status classification
│   │   │   │   └── limits.py          # per-provider RPM + breaker thresholds (data)
│   │   │   ├── router/
│   │   │   │   ├── classifier.py      # regex/keyword rules -> simple/complex/bulk + reason
│   │   │   │   ├── policy.py          # classification -> ordered provider tiers (pure data)
│   │   │   │   └── selector.py        # walks the policy honoring breaker + limiter
│   │   │   ├── redis_client.py
│   │   │   └── trace.py               # fire-and-forget publish to the trace pub/sub channel
│   │   ├── db/                        # async engine, session factory, declarative base
│   │   ├── eval/
│   │   │   ├── golden_set/            # starter.json (20 prompts) + subset.json
│   │   │   ├── judge.py               # cross-provider LLM-as-judge, round-robin excludes generator
│   │   │   ├── metrics.py             # mean/median/pass-rate aggregation (pure, no I/O)
│   │   │   └── runner.py              # generate -> judge -> aggregate -> persist
│   │   ├── models/
│   │   │   ├── db_models.py           # Request, CacheEntry, QuotaLedger, ProviderHealthLog, EvalRun, EvalResult
│   │   │   ├── vector_models.py       # CacheEmbedding — pgvector column + HNSW cosine index
│   │   │   └── schemas.py             # Pydantic v2 API request/response contracts
│   │   ├── providers/
│   │   │   ├── base.py                # ProviderAdapter ABC — the only way a provider is reached
│   │   │   ├── groq_adapter.py        # llama-3.1-8b-instant
│   │   │   ├── cerebras_adapter.py    # llama3.1-8b
│   │   │   ├── gemini_adapter.py      # gemini-flash-latest
│   │   │   └── registry.py            # cached singletons; wraps in ChaosAdapter when enabled
│   │   ├── workers/
│   │   │   ├── cache_writer.py        # arq job — semantic_cache.store() off the request path
│   │   │   ├── eval_worker.py         # arq job — runs an eval, concurrency pinned to 1
│   │   │   ├── maintenance.py         # cron jobs — cache purge, quota rollover (placeholder)
│   │   │   ├── queue_config.py        # sluice:cache / sluice:eval / sluice:maintenance queues
│   │   │   └── worker.py              # WorkerSettings per queue — 3 independent processes
│   │   ├── config.py                  # pydantic-settings — datastores, provider keys, Langfuse/OTel, CORS, chaos flag
│   │   ├── deps.py                    # FastAPI DI: db session, redis client, arq pool, registry
│   │   └── main.py                    # app wiring, CORS, exception handlers -> {error:{type,message,detail}}
│   ├── chaos/
│   │   └── locustfile.py              # load scenarios weighted like real classifier traffic
│   ├── docker/postgres/init.sql       # enable pgvector; provision the separate Langfuse database
│   ├── tests/integration/
│   │   ├── test_contract.py           # wire-shape conformance — exact field names/nullability/enums
│   │   └── test_integration.py        # end-to-end behavioural tests
│   ├── docker-compose.yml             # postgres+pgvector, redis, clickhouse, minio, langfuse ×2, api, 3 arq workers
│   ├── Dockerfile                     # shared image for the API and all three workers
│   └── pyproject.toml
│
└── frontend/
    └── src/
        ├── api/
        │   ├── client.ts               # axios instance, typed ApiClientError, apiGet/apiPost
        │   ├── schemas.ts              # zod contract — the single source of frontend types
        │   ├── sse.ts                  # TraceStreamClient — reconnect with exponential backoff + jitter
        │   └── healthApi.ts
        ├── app/
        │   ├── layout/                 # AppShell, Sidebar, CommandPalette, PageHeader, NavIcons
        │   ├── pages/                  # ErrorPage (route + app-crash boundaries), NotFoundPage
        │   ├── navigation.ts           # single NAV_ITEMS list — sidebar and ⌘K palette both read it
        │   ├── providers.tsx           # QueryClientProvider + app-level providers
        │   └── router.tsx              # /chat  /trace  /eval  /eval/:runId  /admin
        ├── components/{ui,feedback}/   # Badge, Button, Card, Skeleton, Stat, Tooltip, Query states
        ├── features/
        │   ├── chat/                   # ChatPage, ChatComposer, ResponseCard, useChatRequest (TanStack mutation)
        │   ├── trace/                  # CircuitCanvas, RequestPacket, StageTimeline, TraceRequestList,
        │   │                           #   store/traceStore.ts (zustand), hooks/useTraceStream,
        │   │                           #   lib/{graphModel,normalizeTraceFrame,packetPosition,providerCircuitStates}
        │   ├── eval/                   # EvalListPage, EvalDetailPage, AggregateChart, useEvalRuns
        │   └── admin/                  # AdminPage, CircuitBreakerCard, QuotaGauge, QuotaHistoryChart,
        │                               #   CacheStatsCard, hooks/useAdminData (per-panel polling)
        ├── hooks/                      # useHealth, useMediaQuery, useReducedMotion
        ├── lib/                        # cn, queryClient, animationVariants
        ├── store/uiStore.ts            # command-palette open state (shell-level only)
        ├── styles/index.css            # design tokens; contrast ratios asserted in contrast.test.ts
        └── types/{enums,shared.types}.ts  # PROVIDERS / CLASSIFICATIONS / TRACE_STAGES — single vocabulary source
```

---

## ⚙️ Getting Started

### Prerequisites

- **Python 3.13** and [`uv`](https://docs.astral.sh/uv/) for the backend (`backend/.python-version` pins 3.13).
- **Node.js** for the frontend (Vite 8 / React 19 / TypeScript ~6.0).
- **Docker + Docker Compose** — the datastore stack (Postgres+pgvector, Redis, and optionally
  the full Langfuse stack) runs via `docker-compose.yml`.
- **API keys** — [Groq](https://console.groq.com), [Cerebras](https://cloud.cerebras.ai),
  [Google AI Studio](https://aistudio.google.com) (Gemini). The router still runs with any
  subset configured — an unconfigured provider is simply unavailable at call time.

### 1. Clone

```bash
git clone <repo-url>
cd Sluice
```

### 2. Backend

```bash
cd backend
uv sync
cp .env.example .env
```

Fill in `backend/.env` — at minimum the provider keys; the datastore URLs already default to
the ports `docker-compose.yml` publishes:

```bash
GROQ_API_KEY=
CEREBRAS_API_KEY=
GEMINI_API_KEY=

DATABASE_URL=postgresql+asyncpg://sluice:sluice@localhost:5434/sluice
REDIS_URL=redis://:sluice-redis@localhost:6381/0

# Optional — a full local Langfuse stack ships in docker-compose.yml, but no
# application code calls it yet (see the Tech Stack note above).
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_HOST=http://localhost:3002
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317

CORS_ORIGINS=http://localhost:5173
CHAOS_ENABLED=false
```

Bring up the datastores (Postgres+pgvector, Redis, and — if you want it running —
ClickHouse/MinIO/Langfuse) and apply migrations:

```bash
docker compose up -d postgres redis
uv run alembic upgrade head
```

To run the full stack, including the API and all three workers, in containers instead:

```bash
docker compose up -d
```

This publishes the API on `localhost:8008`, Postgres on `5434`, Redis on `6381`, and (if
included) Langfuse on `3002`. See the `x-langfuse-env` block and service definitions in
`docker-compose.yml` for the complete port map.

### 3. Frontend

```bash
cd ../frontend
npm install
cp .env.example .env
```

`frontend/.env` defaults already match a local `docker compose up`:

```bash
VITE_API_BASE_URL=http://localhost:5173      # same-origin — Vite proxies /v1 below
VITE_API_PROXY_TARGET=http://localhost:8008  # must match the API's published port
VITE_API_KEY=                                # optional; sent as X-API-Key when set
VITE_SSE_RECONNECT_MS=2000
```

### 4. Run (outside Docker)

Four processes, four terminal panes — the API, the frontend, and two of the three arq workers
(maintenance is cron-only and optional for local dev, but nothing gets cached without the
cache worker):

```bash
# Pane 1 — API
cd backend && uv run uvicorn app.main:app --reload --port 8008

# Pane 2 — cache worker (nothing is cached without this)
cd backend && uv run arq app.workers.worker.CacheWorkerSettings

# Pane 3 — eval worker (only needed to actually run POST /v1/eval/run)
cd backend && uv run arq app.workers.worker.EvalWorkerSettings

# Pane 4 — frontend
cd frontend && npm run dev   # :5173
```

Open <http://localhost:5173>. Vite proxies `/v1/*` to `VITE_API_PROXY_TARGET`, so every call is
same-origin from the browser's point of view — the backend sends no CORS headers back to a
direct cross-origin call, by design (see `vite.config.ts`).

### 5. Run the eval suite / chaos tests (optional)

```bash
cd backend
uv run pytest                                                  # contract + integration tests
uv run locust -f chaos/locustfile.py --headless -u 20 -r 5 -t 60s --host http://localhost:8008
```

### 6. Deploy for free (Vercel + Render + Neon)

Single-container deploy: the API runs the three arq worker pools in-process
(`RUN_WORKERS_IN_PROCESS=true`), since free tiers have no background-worker type.
Langfuse/ClickHouse/MinIO are not deployed — no application code calls them.

1. **Neon** — create a free project (pgvector is enabled by the first migration,
   no manual step). Copy the **direct** (non-pooled)
   connection string; PgBouncer's transaction mode breaks asyncpg's prepared
   statements. Plain `postgresql://...?sslmode=require` URLs are accepted as-is.
2. **Render** — New → Blueprint → point at this repo. `render.yaml` creates the
   free `sluice-api` web service and free `sluice-redis` Key Value. Fill in
   `DATABASE_URL` and the three provider keys (`CORS_ORIGINS`
   is preset to `https://sluice-gateway.vercel.app`). `start-web.sh` runs `alembic upgrade head`
   on every boot (Render's pre-deploy command is paid-only).
3. **Vercel** — import the repo, root directory `frontend`, set
   `VITE_API_BASE_URL=https://sluice-api.onrender.com` (project `sluice-gateway`). `frontend/vercel.json`
   adds the SPA rewrite so deep links don't 404.

Free-tier caveats: the Render service sleeps after 15 min idle (~1 min cold start,
SSE reconnects on wake) and maintenance crons don't fire while asleep; Render
Key Value is 25MB with no persistence, so breaker/rate-limit state resets on restart.

---

## 🔌 API

All routes are served by the FastAPI app under `/v1`. **None require authentication today** —
see Known Limitations.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/chat` | Classify → cache lookup → route → call (with retry + fail-over) → persist. `200` on success/cache hit, `502` on an upstream failure with routes remaining, `503` when the whole fleet is unavailable |
| `GET` | `/v1/health` | Liveness — app up + DB reachable |
| `GET` | `/v1/health/providers` | Flat `{provider: bool}` — concurrent `health_check()` sweep across all three adapters |
| `POST` | `/v1/eval/run` | Enqueue a golden-set eval run (`202`, `{run_id, status: "queued"}`) — runs async on the eval worker |
| `GET` | `/v1/eval/runs` | Paginated list of eval runs, newest first (`limit` ≤ 200, `offset`) |
| `GET` | `/v1/eval/runs/{run_id}` | Run detail — aggregates (mean relevance/coherence/correctness, pass rate) + every judged item |
| `GET` | `/v1/admin/quota` | Current-period `QuotaLedger` rows per provider |
| `GET` | `/v1/admin/quota/history` | Paginated burn-down history; `start`/`end` filter by period overlap |
| `GET` | `/v1/admin/providers` | Live circuit-breaker state + rate-limit bucket per provider |
| `GET` | `/v1/admin/cache/stats` | Cache hit rate, entry count, average/lifetime hit count |
| `GET` | `/v1/trace/stream` | SSE — every request-lifecycle event, live, fan-out (every connected client sees every event). Optional `?request_id=` filters to one request |

Every error response shares one envelope, set up in `app/main.py`:

```json
{ "error": { "type": "no_route_available", "message": "...", "detail": { "skipped": [...] } } }
```

### Example: chat completion

```bash
curl -X POST http://localhost:8008/v1/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Explain the CAP theorem with a real system example."}'
```

```json
{
  "request_id": "6f2b1e2a-...",
  "response": "...",
  "classification": "complex",
  "provider_used": "gemini",
  "latency_ms": 842,
  "status": "success",
  "fallback_info": null
}
```

A prompt can force bulk routing regardless of length or wording via `metadata.batch_hint`:

```bash
curl -X POST http://localhost:8008/v1/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Summarize this.", "metadata": {"batch_hint": true}}'
```

### Example: trigger and read back an eval run

```bash
curl -X POST http://localhost:8008/v1/eval/run \
  -H "Content-Type: application/json" \
  -d '{"provider": "groq"}'
# -> 202 { "run_id": "...", "status": "queued" }

curl http://localhost:8008/v1/eval/runs/<run_id>
```

### SSE trace stream

`GET /v1/trace/stream` opens with an `event: open` frame, then a keepalive comment every 15s.
The documented contract (`frontend/src/api/schemas.ts` / `types/enums.ts`) is an envelope with
six possible stages — `classify → cache_check → route → call → fallback → complete` — each
carrying `{request_id, stage, timestamp, detail}`.

What `routes_chat.py` actually emits today is flatter, and the frontend normalizes it at the
edge (`features/trace/lib/normalizeTraceFrame.ts`) rather than widening the contract to match:

```
data: {"request_id":"6f2b...","stage":"classify","classification":"complex","reason":"reasoning keyword(s): explain"}
data: {"request_id":"6f2b...","stage":"cache","result":"miss"}
data: {"request_id":"6f2b...","stage":"route","selected":"gemini","skipped":[],"forced_fallback":false}
data: {"request_id":"6f2b...","stage":"call","provider":"gemini","outcome":"success","latency_ms":842}
data: {"request_id":"6f2b...","stage":"complete","status":"success","provider_used":"gemini","request_row_id":"..."}
```

Two differences worth knowing if you consume the stream directly: the wire stage is `"cache"`,
not `"cache_check"`; and there is no distinct `"fallback"` frame — a fail-over to the next
provider tier shows up as a second `route` → `call` pair for the same `request_id`, which the
frontend's `traceStore` already treats as forward progress rather than a regression.

---

## ⚠️ Known Limitations

- **No authentication on any route**, including `POST /v1/chat` (unmetered LLM spend) and the
  entire `/v1/admin` surface. `VITE_API_KEY` exists on the frontend and is sent as `X-API-Key`
  when set, but the backend never checks for it — the header is currently a no-op.
- **Quota accounting has a schema but no writer.** `QuotaLedger` and the `/v1/admin/quota*`
  endpoints are fully wired for reads, but nothing increments `tokens_used` on a live request,
  and `workers/maintenance.py`'s `quota_rollover` job is an explicit logged no-op pending that.
- **The live trace stream doesn't yet match its own documented contract.** See the SSE section
  above — `normalizeTraceFrame.ts` is a real, working shim, but it exists because the backend
  and the Zod schema disagree on stage naming and envelope shape.

---

## 🔮 Future Improvements

- **Instrument provider calls through Langfuse and OpenTelemetry.** Both are already
  dependencies and the full Langfuse stack is already in `docker-compose.yml` — the gap is
  application code that actually opens spans/traces around `ProviderAdapter.complete()`.
- **Quota accounting.** A writer that increments `QuotaLedger.tokens_used` from real
  `ProviderResponse.tokens_used` values, plus a real `quota_rollover` implementation.
- **Auth on `/v1/chat` and `/v1/admin`**, closing the two gaps called out above.
- **Align the live SSE stage names with the documented contract** (`cache` → `cache_check`, and
  either emit a real `fallback` frame or formally drop it from the contract), so
  `normalizeTraceFrame.ts` can be deleted rather than maintained.
- **A cost/FinOps view** on top of quota accounting, once it exists — spend per provider per
  classification tier, not just token counts.
- **Expand the golden set** beyond its current 20 prompts (7 simple / 7 complex / 6 bulk) for a
  statistically sturdier eval signal.
