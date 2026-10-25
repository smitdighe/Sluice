import { describe, expect, it } from 'vitest'

import { TraceEventSchema } from '@/api/schemas'
import { normalizeTraceFrame } from '@/features/trace/lib/normalizeTraceFrame'

const CLOCK = new Date('2026-07-29T12:00:00.000Z')

/** Frames captured verbatim from `GET /v1/trace/stream` on 2026-07-29. */
const LIVE_FRAMES = [
  {
    request_id: '39b5ace0-be54-4409-841a-bc3f1b9318a4',
    stage: 'classify',
    classification: 'simple',
    reason: 'no complex/bulk signal',
  },
  {
    request_id: '39b5ace0-be54-4409-841a-bc3f1b9318a4',
    stage: 'route',
    selected: 'groq',
    skipped: [],
    forced_fallback: false,
  },
  {
    request_id: '39b5ace0-be54-4409-841a-bc3f1b9318a4',
    stage: 'cache',
    result: 'miss',
  },
  {
    request_id: '39b5ace0-be54-4409-841a-bc3f1b9318a4',
    stage: 'call',
    provider: 'groq',
    outcome: 'success',
    latency_ms: 887,
  },
  {
    request_id: '39b5ace0-be54-4409-841a-bc3f1b9318a4',
    stage: 'complete',
    status: 'success',
    provider_used: 'groq',
  },
]

describe('normalizeTraceFrame', () => {
  it('makes every live frame pass TraceEventSchema', () => {
    for (const frame of LIVE_FRAMES) {
      const result = TraceEventSchema.safeParse(normalizeTraceFrame(frame, CLOCK))
      expect(result.success, `frame ${frame.stage} failed validation`).toBe(true)
    }
  })

  it('rejects the raw frames without it — the shim is load-bearing', () => {
    for (const frame of LIVE_FRAMES) {
      expect(TraceEventSchema.safeParse(frame).success).toBe(false)
    }
  })

  it('folds the flattened fields into detail', () => {
    expect(normalizeTraceFrame(LIVE_FRAMES[1], CLOCK)).toEqual({
      request_id: '39b5ace0-be54-4409-841a-bc3f1b9318a4',
      stage: 'route',
      detail: { selected: 'groq', skipped: [], forced_fallback: false },
      timestamp: '2026-07-29T12:00:00.000Z',
    })
  })

  it('renames the cache stage to the enum spelling', () => {
    const normalized = normalizeTraceFrame(LIVE_FRAMES[2], CLOCK) as { stage: string }
    expect(normalized.stage).toBe('cache_check')
  })

  it('stamps receipt time only when the wire carries no timestamp', () => {
    const withTimestamp = normalizeTraceFrame(
      {
        request_id: 'r1',
        stage: 'call',
        timestamp: '2026-01-01T00:00:00Z',
        provider: 'groq',
      },
      CLOCK,
    )
    expect(withTimestamp).toMatchObject({ timestamp: '2026-01-01T00:00:00Z' })
  })

  it('passes a contract-shaped frame through untouched', () => {
    const contractFrame = {
      request_id: 'r1',
      stage: 'call',
      detail: { provider: 'groq' },
      timestamp: '2026-01-01T00:00:00Z',
    }
    expect(normalizeTraceFrame(contractFrame, CLOCK)).toEqual(contractFrame)
  })

  it('leaves an unknown stage alone so the schema can reject it', () => {
    const normalized = normalizeTraceFrame({ request_id: 'r1', stage: 'wat' }, CLOCK) as {
      stage: string
    }
    expect(normalized.stage).toBe('wat')
    expect(TraceEventSchema.safeParse(normalized).success).toBe(false)
  })

  it('returns non-objects unchanged', () => {
    expect(normalizeTraceFrame('nope', CLOCK)).toBe('nope')
    expect(normalizeTraceFrame(null, CLOCK)).toBeNull()
  })

  it('does not mutate the frame it was given', () => {
    const frame = { ...LIVE_FRAMES[0] }
    const snapshot = structuredClone(frame)
    normalizeTraceFrame(frame, CLOCK)
    expect(frame).toEqual(snapshot)
  })
})
