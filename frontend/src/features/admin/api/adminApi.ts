import { apiGet } from '@/api/client'
import {
  CacheStatsSchema,
  ProviderStateListSchema,
  ProvidersHealthSchema,
  QuotaHistorySchema,
  QuotaListSchema,
  type CacheStats,
  type ProviderState,
  type ProvidersHealth,
  type QuotaEntry,
  type QuotaHistory,
} from '@/api/schemas'
import type { DateRangeParams, PaginationParams } from '@/types/shared.types'

/** `GET /v1/admin/quota` — current period usage per provider. */
export function getQuota(signal?: AbortSignal): Promise<QuotaEntry[]> {
  return apiGet('/v1/admin/quota', QuotaListSchema, { signal })
}

/** `GET /v1/admin/quota/history` — paginated usage over a date range. */
export function getQuotaHistory(
  params: DateRangeParams & PaginationParams = {},
  signal?: AbortSignal,
): Promise<QuotaHistory> {
  const { start, end, limit, offset } = params
  return apiGet('/v1/admin/quota/history', QuotaHistorySchema, {
    params: { start, end, limit, offset },
    signal,
  })
}

/** `GET /v1/admin/providers` — circuit state and error counters per provider. */
export function getProviderStates(signal?: AbortSignal): Promise<ProviderState[]> {
  return apiGet('/v1/admin/providers', ProviderStateListSchema, { signal })
}

/** `GET /v1/admin/cache/stats` — cache hit rate and size. */
export function getCacheStats(signal?: AbortSignal): Promise<CacheStats> {
  return apiGet('/v1/admin/cache/stats', CacheStatsSchema, { signal })
}

/** `GET /v1/health/providers` — reachability flag per provider. */
export function getProvidersHealth(signal?: AbortSignal): Promise<ProvidersHealth> {
  return apiGet('/v1/health/providers', ProvidersHealthSchema, { signal })
}
