import type { EvalScore } from '@/features/eval/types'

/**
 * One row per provider, ready for a bar or radar chart.
 *
 * `sampleCount` is carried through so the chart can say how many prompts an
 * average rests on — a 0.9 from one prompt is not a 0.9 from forty.
 */
export interface ProviderAverages {
  provider: string
  /** `null` when no prompt for this provider was successfully scored. */
  relevance: number | null
  coherence: number | null
  correctness: number | null
  /** Rows seen for this provider, scored or not. */
  sampleCount: number
  /** Rows that produced at least one usable metric. */
  scoredCount: number
}

const METRICS = ['relevance', 'coherence', 'correctness'] as const

/** Keeps float noise (0.30000000000000004) out of tooltips and assertions. */
function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/**
 * Pivot the flat `scores[]` array into per-provider averages.
 *
 * Pure: no I/O, no clock, no mutation of the input. Output order is
 * alphabetical by provider so the chart's series order is stable across
 * refetches regardless of the order the backend happened to send.
 *
 * Non-finite metric values (NaN/Infinity) are skipped per-metric rather than
 * poisoning the whole provider's average.
 */
export function transformScoresByProvider(
  scores: readonly EvalScore[],
): ProviderAverages[] {
  const totals = new Map<
    string,
    {
      sums: Record<string, number>
      counts: Record<string, number>
      rows: number
      scoredRows: number
    }
  >()

  for (const score of scores) {
    let entry = totals.get(score.provider)
    if (!entry) {
      entry = { sums: {}, counts: {}, rows: 0, scoredRows: 0 }
      for (const metric of METRICS) {
        entry.sums[metric] = 0
        entry.counts[metric] = 0
      }
      totals.set(score.provider, entry)
    }

    entry.rows += 1
    let rowScored = false
    for (const metric of METRICS) {
      const value = score[metric]
      if (typeof value === 'number' && Number.isFinite(value)) {
        entry.sums[metric] += value
        entry.counts[metric] += 1
        rowScored = true
      }
    }
    if (rowScored) entry.scoredRows += 1
  }

  return [...totals.entries()]
    .map(([provider, entry]) => ({
      provider,
      relevance: average(entry.sums.relevance, entry.counts.relevance),
      coherence: average(entry.sums.coherence, entry.counts.coherence),
      correctness: average(entry.sums.correctness, entry.counts.correctness),
      sampleCount: entry.rows,
      scoredCount: entry.scoredRows,
    }))
    .sort((a, b) => a.provider.localeCompare(b.provider))
}

/**
 * `null` rather than `0` when nothing was scored — a provider the judge never
 * managed to grade has no average, and plotting it as zero would read as a
 * catastrophic score instead of missing data.
 */
function average(sum: number, count: number): number | null {
  return count === 0 ? null : roundTo(sum / count, 4)
}
