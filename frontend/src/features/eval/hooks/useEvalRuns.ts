import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
  type UseQueryOptions,
} from '@tanstack/react-query'

import { ApiClientError } from '@/api/client'
import {
  getEvalRun,
  getEvalRuns,
  runEval,
  type EvalRunRequest,
} from '@/features/eval/api/evalApi'
import type { EvalRunCreated, EvalRunDetail, EvalRunList } from '@/features/eval/types'
import type { PaginationParams } from '@/types/shared.types'

export const evalKeys = {
  all: ['eval'] as const,
  runs: () => [...evalKeys.all, 'runs'] as const,
  runList: (params: PaginationParams) => [...evalKeys.runs(), params] as const,
  run: (runId: string) => [...evalKeys.all, 'run', runId] as const,
}

/** A run list changes only when a run is started or finishes. */
const RUN_LIST_STALE_MS = 30_000
/** A single run's aggregates move while it is still executing. */
const RUN_DETAIL_STALE_MS = 10_000

type QueryOptionsFor<TData> = Omit<
  UseQueryOptions<TData, ApiClientError, TData>,
  'queryKey' | 'queryFn'
>

/** `GET /v1/eval/runs` */
export function useEvalRuns(
  params: PaginationParams = {},
  options?: QueryOptionsFor<EvalRunList>,
) {
  return useQuery<EvalRunList, ApiClientError>({
    queryKey: evalKeys.runList(params),
    queryFn: ({ signal }) => getEvalRuns(params, signal),
    staleTime: RUN_LIST_STALE_MS,
    ...options,
  })
}

/** `GET /v1/eval/runs/{run_id}` — idle until `runId` is known. */
export function useEvalRun(
  runId: string | undefined,
  options?: QueryOptionsFor<EvalRunDetail>,
) {
  return useQuery<EvalRunDetail, ApiClientError>({
    queryKey: evalKeys.run(runId ?? ''),
    queryFn: ({ signal }) => {
      if (!runId) {
        throw new ApiClientError({
          type: 'invalid_request',
          message: 'useEvalRun was queried without a runId.',
        })
      }
      return getEvalRun(runId, signal)
    },
    enabled: Boolean(runId),
    staleTime: RUN_DETAIL_STALE_MS,
    ...options,
  })
}

type RunEvalOptions = Omit<
  UseMutationOptions<EvalRunCreated, ApiClientError, EvalRunRequest | undefined>,
  'mutationFn'
>

/** `POST /v1/eval/run` — invalidates the run list so the new run appears. */
export function useRunEval(options?: RunEvalOptions) {
  const client = useQueryClient()

  return useMutation<EvalRunCreated, ApiClientError, EvalRunRequest | undefined>({
    mutationFn: (payload) => runEval(payload ?? {}),
    ...options,
    onSuccess: (...args) => {
      void client.invalidateQueries({ queryKey: evalKeys.runs() })
      options?.onSuccess?.(...args)
    },
  })
}
