/**
 * Admin domain types. Re-exported from the Zod schemas so this file never
 * becomes a second, drifting definition of the wire contract.
 */
export type {
  CacheStats,
  Health,
  ProviderState,
  ProvidersHealth,
  QuotaEntry,
  QuotaHistory,
  QuotaHistoryPoint,
} from '@/api/schemas'

export type { CircuitState, Provider } from '@/types/enums'
