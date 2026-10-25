import { describe, expect, it } from 'vitest'

import { transformScoresByProvider } from '@/features/eval/scoresByProvider.transform'
import type { EvalScore } from '@/features/eval/types'

const score = (
  provider: string,
  values: [number | null, number | null, number | null],
  prompt = 'p',
): EvalScore => ({
  prompt,
  provider,
  relevance: values[0],
  coherence: values[1],
  correctness: values[2],
})

describe('transformScoresByProvider', () => {
  it('returns an empty array for no scores', () => {
    expect(transformScoresByProvider([])).toEqual([])
  })

  it('averages each metric per provider', () => {
    const result = transformScoresByProvider([
      score('groq', [1, 0.5, 0.4]),
      score('groq', [0, 0.5, 0.6]),
    ])

    expect(result).toEqual([
      {
        provider: 'groq',
        relevance: 0.5,
        coherence: 0.5,
        correctness: 0.5,
        sampleCount: 2,
        scoredCount: 2,
      },
    ])
  })

  it('keeps providers separate and sorts them alphabetically', () => {
    const result = transformScoresByProvider([
      score('gemini', [0.2, 0.2, 0.2]),
      score('cerebras', [0.4, 0.4, 0.4]),
      score('groq', [0.8, 0.8, 0.8]),
    ])

    expect(result.map((row) => row.provider)).toEqual(['cerebras', 'gemini', 'groq'])
    expect(result[2]).toMatchObject({ provider: 'groq', relevance: 0.8, sampleCount: 1 })
  })

  it('is order-independent — input order cannot change the averages', () => {
    const rows = [
      score('groq', [0.1, 0.2, 0.3], 'a'),
      score('gemini', [0.9, 0.8, 0.7], 'b'),
      score('groq', [0.5, 0.6, 0.7], 'c'),
    ]

    expect(transformScoresByProvider(rows)).toEqual(
      transformScoresByProvider([...rows].reverse()),
    )
  })

  it('rounds away float drift', () => {
    const result = transformScoresByProvider([
      score('groq', [0.1, 0, 0]),
      score('groq', [0.2, 0, 0]),
    ])

    // (0.1 + 0.2) / 2 is 0.15000000000000002 unrounded
    expect(result[0].relevance).toBe(0.15)
  })

  it('skips non-finite values per metric instead of poisoning the provider', () => {
    const result = transformScoresByProvider([
      score('groq', [Number.NaN, 0.4, 0.6]),
      score('groq', [0.8, 0.6, 0.4]),
    ])

    expect(result[0]).toEqual({
      provider: 'groq',
      relevance: 0.8, // only the one finite sample counted
      coherence: 0.5,
      correctness: 0.5,
      sampleCount: 2,
      scoredCount: 2,
    })
  })

  /* ── Nullable metrics — a judge call can fail to score a prompt ─── */

  it('excludes null metrics from the average without dropping the row', () => {
    const result = transformScoresByProvider([
      score('groq', [null, 0.4, 0.6]),
      score('groq', [0.8, 0.6, 0.4]),
    ])

    expect(result[0]).toEqual({
      provider: 'groq',
      relevance: 0.8, // the null sample contributes nothing
      coherence: 0.5,
      correctness: 0.5,
      sampleCount: 2,
      scoredCount: 2,
    })
  })

  it('reports null — not 0 — when a metric was never scored', () => {
    const result = transformScoresByProvider([
      score('groq', [null, 0.4, 0.6]),
      score('groq', [null, 0.6, 0.4]),
    ])

    expect(result[0].relevance).toBeNull()
    expect(result[0].coherence).toBe(0.5)
  })

  it('reports a fully unscored provider as all-null with scoredCount 0', () => {
    const result = transformScoresByProvider([
      score('groq', [null, null, null]),
      score('groq', [null, null, null]),
    ])

    expect(result[0]).toEqual({
      provider: 'groq',
      relevance: null,
      coherence: null,
      correctness: null,
      sampleCount: 2,
      scoredCount: 0,
    })
  })

  it('counts a row as scored if any single metric survived', () => {
    const result = transformScoresByProvider([
      score('groq', [0.5, null, null]),
      score('groq', [null, null, null]),
    ])

    expect(result[0]).toMatchObject({ sampleCount: 2, scoredCount: 1, relevance: 0.5 })
  })

  it('does not mutate its input', () => {
    const rows = [score('groq', [0.5, null, 0.5])]
    const snapshot = structuredClone(rows)

    transformScoresByProvider(rows)

    expect(rows).toEqual(snapshot)
  })

  it('is referentially pure — same input, equal output every call', () => {
    const rows = [score('groq', [0.3, null, 0.5]), score('gemini', [0.6, 0.7, 0.8])]

    expect(transformScoresByProvider(rows)).toEqual(transformScoresByProvider(rows))
  })
})
