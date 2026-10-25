/**
 * Trace domain types. Re-exported from the Zod schemas so this file never
 * becomes a second, drifting definition of the wire contract.
 *
 * Grouping events by `request_id` and holding them in a store is a later
 * phase — this file is types only.
 */
export type { TraceEvent } from '@/api/schemas'

export type { SseStatus, TraceStreamOptions } from '@/api/sse'
export type { TraceStage } from '@/types/enums'
