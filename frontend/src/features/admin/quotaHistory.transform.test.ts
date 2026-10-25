import { describe, expect, it } from 'vitest'

import {
  defaultHistoryRange,
  transformQuotaHistory,
} from '@/features/admin/quotaHistory.transform'
import type { QuotaHistoryPoint } from '@/features/admin/types'

const point = (
  provider: string,
  periodStart: string,
  tokensUsed: number,
): QuotaHistoryPoint => ({
  provider,
  tokens_used: tokensUsed,
  token_budget: 1_000_000,
  period_start: periodStart,
  period_end: periodStart,
})

describe('transformQuotaHistory', () => {
  it('returns empty rows and providers for no points', () => {
    expect(transformQuotaHistory([])).toEqual({ rows: [], providers: [] })
  })

  it('collapses one row per timestamp with a key per provider', () => {
    const result = transformQuotaHistory([
      point('groq', '2026-07-29T10:00:00Z', 100),
      point('gemini', '2026-07-29T10:00:00Z', 250),
      point('groq', '2026-07-29T11:00:00Z', 180),
    ])

    expect(result.providers).toEqual(['gemini', 'groq'])
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toMatchObject({
      timestamp: '2026-07-29T10:00:00Z',
      groq: 100,
      gemini: 250,
    })
    expect(result.rows[1]).toMatchObject({ groq: 180 })
    expect(result.rows[1].gemini).toBeUndefined()
  })

  it('sorts rows chronologically regardless of input order', () => {
    const result = transformQuotaHistory([
      point('groq', '2026-07-29T12:00:00Z', 3),
      point('groq', '2026-07-29T10:00:00Z', 1),
      point('groq', '2026-07-29T11:00:00Z', 2),
    ])

    expect(result.rows.map((row) => row.groq)).toEqual([1, 2, 3])
  })

  it('sorts provider keys alphabetically for a stable series order', () => {
    const result = transformQuotaHistory([
      point('groq', '2026-07-29T10:00:00Z', 1),
      point('cerebras', '2026-07-29T10:00:00Z', 2),
      point('gemini', '2026-07-29T10:00:00Z', 3),
    ])

    expect(result.providers).toEqual(['cerebras', 'gemini', 'groq'])
  })

  it('takes the last value for a duplicated provider/timestamp pair', () => {
    const result = transformQuotaHistory([
      point('groq', '2026-07-29T10:00:00Z', 100),
      point('groq', '2026-07-29T10:00:00Z', 175),
    ])

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].groq).toBe(175)
  })

  it('accepts Z, offset and naive timestamps', () => {
    const result = transformQuotaHistory([
      point('groq', '2026-07-29T10:00:00Z', 1),
      point('groq', '2026-07-29T11:00:00+00:00', 2),
      point('groq', '2026-07-29T12:00:00', 3),
    ])

    expect(result.rows).toHaveLength(3)
    expect(result.rows.every((row) => Number.isFinite(row.time))).toBe(true)
  })

  it('drops points with an unparseable timestamp', () => {
    const result = transformQuotaHistory([
      point('groq', 'not-a-date', 999),
      point('groq', '2026-07-29T10:00:00Z', 1),
    ])

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].groq).toBe(1)
  })

  it('does not mutate its input', () => {
    const points = [point('groq', '2026-07-29T10:00:00Z', 1)]
    const snapshot = structuredClone(points)

    transformQuotaHistory(points)

    expect(points).toEqual(snapshot)
  })

  it('is referentially pure — same input, equal output every call', () => {
    const points = [
      point('groq', '2026-07-29T10:00:00Z', 1),
      point('gemini', '2026-07-29T11:00:00Z', 2),
    ]

    expect(transformQuotaHistory(points)).toEqual(transformQuotaHistory(points))
  })
})

describe('defaultHistoryRange', () => {
  it('spans exactly 24 hours back from the supplied clock', () => {
    const now = new Date('2026-07-29T12:00:00Z')
    const { start, end } = defaultHistoryRange(now)

    expect(end).toBe('2026-07-29T12:00:00.000Z')
    expect(start).toBe('2026-07-28T12:00:00.000Z')
  })

  it('takes the clock as a parameter, so it is testable without mocking Date', () => {
    const a = defaultHistoryRange(new Date('2026-01-01T00:00:00Z'))
    const b = defaultHistoryRange(new Date('2026-01-01T00:00:00Z'))

    expect(a).toEqual(b)
  })
})
