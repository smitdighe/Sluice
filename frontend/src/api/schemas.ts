import { z } from 'zod'

import {
  CHAT_STATUSES,
  CIRCUIT_STATES,
  CLASSIFICATIONS,
  EVAL_RUN_STATUSES,
  PROVIDERS,
  TRACE_STAGES,
} from '@/types/enums'

/**
 * Runtime contract for every backend response.
 *
 * Two deliberate choices:
 *
 * 1. Types are inferred from these schemas (`z.infer`) and re-exported by each
 *    feature's `types.ts`. Nothing hand-writes a response interface, so a
 *    schema edit propagates to every consumer as a type error.
 *
 * 2. Objects are non-strict (Zod's default): unknown keys are stripped, not
 *    rejected. A backend that adds a field will not break the UI; a backend
 *    that removes or retypes a declared field fails loudly, which is what we
 *    actually want to hear about.
 */

/* ── Primitives ──────────────────────────────────────────────────── */

/**
 * ISO-8601 timestamp. `offset` and `local` are both permitted because a
 * Python backend may emit `...Z`, `...+00:00`, or a naive `...T10:00:00`
 * depending on how the datetime was constructed.
 */
const isoTimestamp = z.iso.datetime({ offset: true, local: true })

/** Free-form object bag — `detail` payloads are intentionally unstructured. */
const unknownRecord = z.record(z.string(), z.unknown())

export const ProviderSchema = z.enum(PROVIDERS)
export const ClassificationSchema = z.enum(CLASSIFICATIONS)
export const ChatStatusSchema = z.enum(CHAT_STATUSES)
export const CircuitStateSchema = z.enum(CIRCUIT_STATES)
export const EvalRunStatusSchema = z.enum(EVAL_RUN_STATUSES)
export const TraceStageSchema = z.enum(TRACE_STAGES)

/* ── Errors ──────────────────────────────────────────────────────── */

export const ApiErrorSchema = z.object({
  error: z.object({
    type: z.string(),
    message: z.string(),
    detail: unknownRecord,
  }),
})
export type ApiErrorPayload = z.infer<typeof ApiErrorSchema>

/* ── Pagination ──────────────────────────────────────────────────── */

/**
 * ASSUMPTION — the contract says "paginated" for `/v1/eval/runs` and
 * `/v1/admin/quota/history` but does not give the envelope. This is the shape
 * assumed; if the backend differs, this factory is the single place to change.
 */
export function paginatedSchema<TItem extends z.ZodType>(item: TItem) {
  return z.object({
    items: z.array(item),
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
  })
}

/* ── Chat ────────────────────────────────────────────────────────── */

export const ChatMetadataSchema = z.looseObject({
  batch_hint: z.boolean().optional(),
})

export const ChatRequestSchema = z.object({
  prompt: z.string(),
  metadata: ChatMetadataSchema.optional(),
})

/** A provider the router declined to use, and why. */
export const FallbackSkipSchema = z.object({
  /* Contract types this as a bare string, not the Provider enum — kept wide
     so an unknown provider name cannot fail an otherwise-valid response. */
  provider: z.string(),
  reason: z.string(),
})

/**
 * Present as an object when the router skipped at least one provider,
 * otherwise explicitly `null`. Nullable, never optional — the key is always
 * on the wire.
 */
export const FallbackInfoSchema = z.object({
  skipped: z.array(FallbackSkipSchema),
})

export const ChatResponseSchema = z.object({
  response: z.string(),
  provider_used: ProviderSchema,
  classification: ClassificationSchema,
  status: ChatStatusSchema,
  latency_ms: z.number(),
  fallback_info: FallbackInfoSchema.nullable(),
  request_id: z.string(),
})

export type ChatMetadata = z.infer<typeof ChatMetadataSchema>
export type ChatRequest = z.infer<typeof ChatRequestSchema>
export type FallbackSkip = z.infer<typeof FallbackSkipSchema>
export type FallbackInfo = z.infer<typeof FallbackInfoSchema>
export type ChatResponse = z.infer<typeof ChatResponseSchema>

/* ── Health ──────────────────────────────────────────────────────── */

export const HealthSchema = z.object({
  status: z.literal('ok'),
})

/** One flag per supported provider — mirrors `PROVIDERS` in `types/enums.ts`. */
export const ProvidersHealthSchema = z.object({
  groq: z.boolean(),
  cerebras: z.boolean(),
  gemini: z.boolean(),
})

export type Health = z.infer<typeof HealthSchema>
export type ProvidersHealth = z.infer<typeof ProvidersHealthSchema>

/* ── Eval ────────────────────────────────────────────────────────── */

/** Response to `POST /v1/eval/run` — accepted and queued, nothing more. */
export const EvalRunCreatedSchema = z.object({
  run_id: z.string(),
  status: z.literal('queued'),
})

/**
 * Every aggregate is nullable: a run with nothing successfully scored has no
 * mean to report. `null` means "not computed", which is distinct from `0`.
 */
export const EvalAggregatesSchema = z.object({
  relevance_mean: z.number().nullable(),
  coherence_mean: z.number().nullable(),
  correctness_mean: z.number().nullable(),
  pass_rate: z.number().nullable(),
})

/**
 * Metrics are nullable by design — a judge call can legitimately fail to
 * score a given prompt, and that row still belongs in the run.
 */
export const EvalScoreSchema = z.object({
  prompt: z.string(),
  provider: z.string(),
  relevance: z.number().nullable(),
  coherence: z.number().nullable(),
  correctness: z.number().nullable(),
})

/**
 * List-row shape for `GET /v1/eval/runs`.
 *
 * ASSUMPTION — the contract does not spell out the row. Only the two fields
 * every run is known to carry are declared; any extras the backend sends are
 * stripped rather than rejected.
 */
export const EvalRunSchema = z.object({
  run_id: z.string(),
  status: EvalRunStatusSchema,
})

/** Full record for `GET /v1/eval/runs/{run_id}`. */
export const EvalRunDetailSchema = z.object({
  run_id: z.string(),
  status: EvalRunStatusSchema,
  aggregates: EvalAggregatesSchema,
  scores: z.array(EvalScoreSchema),
})

export const EvalRunListSchema = paginatedSchema(EvalRunSchema)

export type EvalRunCreated = z.infer<typeof EvalRunCreatedSchema>
export type EvalAggregates = z.infer<typeof EvalAggregatesSchema>
export type EvalScore = z.infer<typeof EvalScoreSchema>
export type EvalRun = z.infer<typeof EvalRunSchema>
export type EvalRunDetail = z.infer<typeof EvalRunDetailSchema>
export type EvalRunList = z.infer<typeof EvalRunListSchema>

/* ── Admin ───────────────────────────────────────────────────────── */

export const QuotaEntrySchema = z.object({
  provider: z.string(),
  tokens_used: z.number(),
  token_budget: z.number(),
  period_start: isoTimestamp,
  period_end: isoTimestamp,
})

/**
 * ASSUMPTION — `/v1/admin/quota/history` is described only as "time-series,
 * paginated". Modelled as the same record repeated per elapsed period, which
 * is the reading that requires inventing no new fields.
 */
export const QuotaHistoryPointSchema = QuotaEntrySchema
export const QuotaHistorySchema = paginatedSchema(QuotaHistoryPointSchema)

export const ProviderStateSchema = z.object({
  provider: z.string(),
  circuit_state: CircuitStateSchema,
  rate_limit_remaining: z.number(),
  error_count: z.number(),
})

export const CacheStatsSchema = z.object({
  hit_rate: z.number(),
  total_entries: z.number(),
  avg_hit_count: z.number(),
})

export const QuotaListSchema = z.array(QuotaEntrySchema)
export const ProviderStateListSchema = z.array(ProviderStateSchema)

export type QuotaEntry = z.infer<typeof QuotaEntrySchema>
export type QuotaHistoryPoint = z.infer<typeof QuotaHistoryPointSchema>
export type QuotaHistory = z.infer<typeof QuotaHistorySchema>
export type ProviderState = z.infer<typeof ProviderStateSchema>
export type CacheStats = z.infer<typeof CacheStatsSchema>

/* ── Trace ───────────────────────────────────────────────────────── */

export const TraceEventSchema = z.object({
  request_id: z.string(),
  stage: TraceStageSchema,
  detail: unknownRecord,
  timestamp: isoTimestamp,
})

export type TraceEvent = z.infer<typeof TraceEventSchema>
