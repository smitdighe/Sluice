import { apiGet, apiPost } from '@/api/client'
import {
  EvalRunCreatedSchema,
  EvalRunDetailSchema,
  EvalRunListSchema,
  type EvalRunCreated,
  type EvalRunDetail,
  type EvalRunList,
} from '@/api/schemas'
import type { PaginationParams } from '@/types/shared.types'

/**
 * Body for `POST /v1/eval/run`.
 *
 * ASSUMPTION — the contract documents the response but not the request body.
 * Left open rather than invented; tighten to a real schema once the accepted
 * fields are known.
 */
export type EvalRunRequest = Record<string, unknown>

/** `POST /v1/eval/run` — enqueues a run and returns its id immediately. */
export function runEval(
  payload: EvalRunRequest = {},
  signal?: AbortSignal,
): Promise<EvalRunCreated> {
  return apiPost('/v1/eval/run', payload, EvalRunCreatedSchema, { signal })
}

/** `GET /v1/eval/runs` — paginated list of runs. */
export function getEvalRuns(
  params: PaginationParams = {},
  signal?: AbortSignal,
): Promise<EvalRunList> {
  const { limit, offset } = params
  return apiGet('/v1/eval/runs', EvalRunListSchema, {
    params: { limit, offset },
    signal,
  })
}

/** `GET /v1/eval/runs/{run_id}` — aggregates plus per-prompt scores. */
export function getEvalRun(runId: string, signal?: AbortSignal): Promise<EvalRunDetail> {
  return apiGet(`/v1/eval/runs/${encodeURIComponent(runId)}`, EvalRunDetailSchema, {
    signal,
  })
}
