import type { QuotaHistoryPoint } from '@/features/admin/types'

/**
 * One row per timestamp, one key per provider — the shape Recharts wants for
 * a multi-series line chart.
 *
 * The API returns a flat per-provider series; passing that straight to
 * Recharts would draw one line and drop the rest.
 */
export interface QuotaHistoryRow {
  /** Raw ISO string from `period_start`, kept for sorting and tooltips. */
  timestamp: string
  /** Epoch milliseconds, so the chart can use a numeric time axis. */
  time: number
  /** `tokens_used` per provider at this timestamp. */
  [provider: string]: string | number
}

export interface QuotaHistorySeries {
  rows: QuotaHistoryRow[]
  /** Every provider seen, alphabetical — one `<Line>` each. */
  providers: string[]
}

/**
 * Reshape the time-series into Recharts rows.
 *
 * Pure: no clock, no I/O, input untouched.
 *
 * Two decisions worth knowing:
 *  - `period_start` is the x-value; a bucket is plotted at the moment it opened.
 *  - a duplicate (provider, timestamp) pair is last-one-wins, matching how a
 *    corrected re-emission of the same bucket should behave.
 *
 * Points with an unparseable `period_start` are dropped rather than sorted to
 * an arbitrary position.
 */
export function transformQuotaHistory(
  points: readonly QuotaHistoryPoint[],
): QuotaHistorySeries {
  const byTimestamp = new Map<string, QuotaHistoryRow>()
  const providers = new Set<string>()

  for (const point of points) {
    const time = Date.parse(point.period_start)
    if (Number.isNaN(time)) continue

    providers.add(point.provider)

    let row = byTimestamp.get(point.period_start)
    if (!row) {
      row = { timestamp: point.period_start, time }
      byTimestamp.set(point.period_start, row)
    }
    row[point.provider] = point.tokens_used
  }

  const sortedProviders = [...providers].sort((a, b) => a.localeCompare(b))

  const rows = [...byTimestamp.values()].sort((a, b) => a.time - b.time)

  return { rows, providers: sortedProviders }
}

/** Default window for the history controls: the last 24 hours. */
export function defaultHistoryRange(now: Date = new Date()): {
  start: string
  end: string
} {
  const end = new Date(now)
  const start = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  return { start: start.toISOString(), end: end.toISOString() }
}
