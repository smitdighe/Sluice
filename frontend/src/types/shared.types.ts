import type { ApiErrorPayload } from '@/api/schemas'

/**
 * The error envelope every route returns on failure:
 *
 *   { error: { type: string, message: string, detail: Record<string, unknown> } }
 *
 * Inferred from `ApiErrorSchema` rather than restated, so the runtime check
 * and the compile-time type cannot disagree.
 */
export type ApiError = ApiErrorPayload

/** Just the inner object, which is what `ApiClientError` carries. */
export type ApiErrorBody = ApiErrorPayload['error']

/* ── Pagination ──────────────────────────────────────────────────── */

/** Query params accepted by the paginated list routes. */
export interface PaginationParams {
  limit?: number
  offset?: number
}

/**
 * Envelope returned by paginated routes.
 *
 * ASSUMPTION — the backend contract says "paginated" without giving the
 * envelope. Mirrors `paginatedSchema()` in `api/schemas.ts`; change both
 * together if the real shape differs.
 */
export interface Paginated<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

/** Inclusive ISO-8601 date range, used by `/v1/admin/quota/history`. */
export interface DateRangeParams {
  start?: string
  end?: string
}
