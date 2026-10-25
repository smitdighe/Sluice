/**
 * Backend enums, mirrored twice on purpose:
 *
 *   - the `as const` array is the runtime value — iterate it to render every
 *     provider/state even when the API returns data for only some of them;
 *   - the union type is derived from that array, so the two can never drift.
 *
 * Zod schemas in `api/schemas.ts` build their `z.enum()` from these arrays,
 * which makes this file the single source of truth for the vocabulary.
 */

export const PROVIDERS = ['groq', 'cerebras', 'gemini'] as const
export type Provider = (typeof PROVIDERS)[number]

export const CLASSIFICATIONS = ['simple', 'complex', 'bulk'] as const
export type Classification = (typeof CLASSIFICATIONS)[number]

export const CHAT_STATUSES = ['success', 'error', 'cached'] as const
export type ChatStatus = (typeof CHAT_STATUSES)[number]

export const CIRCUIT_STATES = ['closed', 'open', 'half_open'] as const
export type CircuitState = (typeof CIRCUIT_STATES)[number]

export const EVAL_RUN_STATUSES = ['queued', 'running', 'complete', 'failed'] as const
export type EvalRunStatus = (typeof EVAL_RUN_STATUSES)[number]

/**
 * Pipeline stages emitted on the trace stream. `fallback` is conditional —
 * it only appears when a provider was skipped, so consumers must not assume
 * every request_id produces all six.
 */
export const TRACE_STAGES = [
  'classify',
  'cache_check',
  'route',
  'call',
  'fallback',
  'complete',
] as const
export type TraceStage = (typeof TRACE_STAGES)[number]
