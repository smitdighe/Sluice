import { useQuery, type UseQueryOptions } from '@tanstack/react-query'

import type { ApiClientError } from '@/api/client'
import {
  getCacheStats,
  getProviderStates,
  getProvidersHealth,
  getQuota,
  getQuotaHistory,
} from '@/features/admin/api/adminApi'
import type {
  CacheStats,
  ProviderState,
  ProvidersHealth,
  QuotaEntry,
  QuotaHistory,
} from '@/features/admin/types'
import type { DateRangeParams, PaginationParams } from '@/types/shared.types'

export const adminKeys = {
  all: ['admin'] as const,
  quota: () => [...adminKeys.all, 'quota'] as const,
  quotaHistory: (params: DateRangeParams & PaginationParams) =>
    [...adminKeys.quota(), 'history', params] as const,
  providers: () => [...adminKeys.all, 'providers'] as const,
  cacheStats: () => [...adminKeys.all, 'cache', 'stats'] as const,
  providersHealth: () => [...adminKeys.all, 'health', 'providers'] as const,
}

type QueryOptionsFor<TData> = Omit<
  UseQueryOptions<TData, ApiClientError, TData>,
  'queryKey' | 'queryFn'
>

/* ── Polling cadence ─────────────────────────────────────────────
 *
 * Paced to how fast each number can actually change, not to how live we would
 * like the page to feel:
 *
 *   - provider states flip on a single failed call, and the same data colours
 *     the trace canvas's provider nodes, so a stale circuit reads as a lie
 *     about the system's current shape;
 *   - quota accrues per request but is judged against a period budget, so
 *     second-level precision is meaningless;
 *   - cache stats are ratios over a large denominator — they barely move
 *     between adjacent polls.
 *
 * `refetchIntervalInBackground` is left at its default `false`, so TanStack
 * Query suspends these timers while the tab is hidden and resumes on return.
 * `refetchOnWindowFocus` is enabled per-query (the client default is off) so
 * coming back to the tab shows current data immediately rather than after up
 * to a full interval.
 */
export const PROVIDER_POLL_MS = 5_000
export const QUOTA_POLL_MS = 15_000
export const CACHE_POLL_MS = 30_000

/**
 * Polled queries do not retry.
 *
 * The client-wide policy retries transport failures twice, which is right for
 * a one-shot fetch and wrong for a query that is about to run again anyway:
 * while the backend is down it would triple the request volume and the console
 * noise for no new information. The next tick is the retry. Manual `refetch()`
 * from an error state is unaffected.
 */
const POLLED = { retry: false } as const

/** `GET /v1/admin/quota` */
export function useQuota(options?: QueryOptionsFor<QuotaEntry[]>) {
  return useQuery<QuotaEntry[], ApiClientError>({
    queryKey: adminKeys.quota(),
    queryFn: ({ signal }) => getQuota(signal),
    refetchInterval: QUOTA_POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: QUOTA_POLL_MS,
    ...POLLED,
    ...options,
  })
}

/**
 * `GET /v1/admin/quota/history`
 *
 * Not polled: it is a range query over closed periods. New points only appear
 * when a period rolls over, which the 15s quota poll already reveals.
 */
export function useQuotaHistory(
  params: DateRangeParams & PaginationParams = {},
  options?: QueryOptionsFor<QuotaHistory>,
) {
  return useQuery<QuotaHistory, ApiClientError>({
    queryKey: adminKeys.quotaHistory(params),
    queryFn: ({ signal }) => getQuotaHistory(params, signal),
    ...options,
  })
}

/**
 * `GET /v1/admin/providers`
 *
 * The fastest-moving of these, and the source the trace canvas colours its
 * provider nodes from.
 */
export function useProviderStates(options?: QueryOptionsFor<ProviderState[]>) {
  return useQuery<ProviderState[], ApiClientError>({
    queryKey: adminKeys.providers(),
    queryFn: ({ signal }) => getProviderStates(signal),
    refetchInterval: PROVIDER_POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: PROVIDER_POLL_MS,
    ...POLLED,
    ...options,
  })
}

/** `GET /v1/admin/cache/stats` */
export function useCacheStats(options?: QueryOptionsFor<CacheStats>) {
  return useQuery<CacheStats, ApiClientError>({
    queryKey: adminKeys.cacheStats(),
    queryFn: ({ signal }) => getCacheStats(signal),
    refetchInterval: CACHE_POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: CACHE_POLL_MS,
    ...POLLED,
    ...options,
  })
}

/** `GET /v1/health/providers` */
export function useProvidersHealth(options?: QueryOptionsFor<ProvidersHealth>) {
  return useQuery<ProvidersHealth, ApiClientError>({
    queryKey: adminKeys.providersHealth(),
    queryFn: ({ signal }) => getProvidersHealth(signal),
    refetchInterval: PROVIDER_POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: PROVIDER_POLL_MS,
    ...POLLED,
    ...options,
  })
}
