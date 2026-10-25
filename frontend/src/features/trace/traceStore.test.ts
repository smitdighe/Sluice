import { beforeEach, describe, expect, it } from 'vitest'

import type { TraceEvent } from '@/api/schemas'
import {
  COMPLETED_TTL_MS,
  INTERRUPTED_TTL_MS,
  INTERRUPT_GRACE_MS,
  MAX_TRACES,
  STALE_TTL_MS,
  selectActiveTraces,
  useTraceStore,
} from '@/features/trace/store/traceStore'
import type { TraceStage } from '@/types/enums'

const T0 = Date.UTC(2026, 6, 29, 12, 0, 0)

function event(
  requestId: string,
  stage: TraceStage,
  detail: Record<string, unknown> = {},
): TraceEvent {
  return {
    request_id: requestId,
    stage,
    detail,
    timestamp: new Date(T0).toISOString(),
  }
}

const store = () => useTraceStore.getState()

function feed(requestId: string, stages: TraceStage[], startAt = T0) {
  stages.forEach((stage, index) => {
    store().addEvent(event(requestId, stage), startAt + index * 100)
  })
}

beforeEach(() => {
  store().clear()
})

describe('addEvent', () => {
  it('groups events by request_id into ordered timelines', () => {
    store().addEvent(event('req_a', 'classify'), T0)
    store().addEvent(event('req_b', 'classify'), T0 + 10)
    store().addEvent(event('req_a', 'cache_check'), T0 + 20)

    const traces = selectActiveTraces(store())
    expect(traces.map((trace) => trace.requestId)).toEqual(['req_a', 'req_b'])
    expect(traces[0].events.map((entry) => entry.stage)).toEqual([
      'classify',
      'cache_check',
    ])
    expect(traces[1].events).toHaveLength(1)
  })

  it('tracks each request independently when they interleave', () => {
    store().addEvent(event('req_a', 'classify'), T0)
    store().addEvent(event('req_b', 'classify'), T0 + 5)
    store().addEvent(event('req_a', 'cache_check', { hit: true }), T0 + 10)
    store().addEvent(event('req_b', 'route', { provider: 'gemini' }), T0 + 15)
    store().addEvent(event('req_a', 'complete', { status: 'cached' }), T0 + 20)

    const { traces } = store()
    expect(traces.req_a.cacheHit).toBe(true)
    expect(traces.req_a.isComplete).toBe(true)
    expect(traces.req_a.provider).toBeNull()

    expect(traces.req_b.cacheHit).toBe(false)
    expect(traces.req_b.isComplete).toBe(false)
    expect(traces.req_b.provider).toBe('gemini')
    expect(traces.req_b.currentStage).toBe('route')
  })

  it('advances the current stage but never walks it backwards', () => {
    feed('req_a', ['classify', 'cache_check', 'route', 'call'])
    expect(store().traces.req_a.currentStage).toBe('call')

    // A duplicate or late frame still lands in the timeline...
    store().addEvent(event('req_a', 'cache_check'), T0 + 500)
    expect(store().traces.req_a.currentStage).toBe('call')
    expect(store().traces.req_a.events).toHaveLength(5)
  })

  it('bumps a revision per ingested event', () => {
    feed('req_a', ['classify', 'cache_check', 'route'])
    expect(store().traces.req_a.revision).toBe(3)
  })
})

describe('derived flow state', () => {
  it('records a fallback, the provider taken up and the one abandoned', () => {
    store().addEvent(event('req_a', 'route', { provider: 'cerebras' }), T0)
    store().addEvent(event('req_a', 'call', { provider: 'cerebras' }), T0 + 100)
    store().addEvent(
      event('req_a', 'fallback', {
        from: 'cerebras',
        to: 'gemini',
        reason: 'circuit_open',
      }),
      T0 + 200,
    )

    const trace = store().traces.req_a
    expect(trace.didFallback).toBe(true)
    expect(trace.provider).toBe('gemini')
    expect(trace.skippedProvider).toBe('cerebras')
    expect(trace.skipped).toEqual(['cerebras'])
  })

  it('accumulates every skipped provider across repeated fallbacks', () => {
    store().addEvent(event('req_a', 'call', { provider: 'groq' }), T0)
    store().addEvent(
      event('req_a', 'fallback', { from: 'groq', to: 'cerebras' }),
      T0 + 100,
    )
    store().addEvent(
      event('req_a', 'fallback', { from: 'cerebras', to: 'gemini' }),
      T0 + 200,
    )

    const trace = store().traces.req_a
    expect(trace.skipped).toEqual(['groq', 'cerebras'])
    expect(trace.provider).toBe('gemini')
  })

  it('falls back to the current provider when a fallback names no origin', () => {
    store().addEvent(event('req_a', 'call', { provider: 'groq' }), T0)
    store().addEvent(event('req_a', 'fallback', { to: 'gemini' }), T0 + 100)

    expect(store().traces.req_a.skippedProvider).toBe('groq')
  })

  it('treats an unrecognised cache payload as a miss, not a hit', () => {
    store().addEvent(event('req_a', 'cache_check', { lookup_ms: 3 }), T0)
    expect(store().traces.req_a.cacheHit).toBe(false)
  })

  it('reads an explicit cache miss as a miss', () => {
    store().addEvent(event('req_a', 'cache_check', { hit: false }), T0)
    expect(store().traces.req_a.cacheHit).toBe(false)
  })

  it('ignores a provider name that is not a known provider', () => {
    store().addEvent(event('req_a', 'route', { provider: 'ollama' }), T0)
    expect(store().traces.req_a.provider).toBeNull()
  })
})

describe('pipeline flows', () => {
  it('drives a success trace to a provider and a terminus', () => {
    store().addEvent(event('req_success', 'classify', { classification: 'complex' }), T0)
    store().addEvent(event('req_success', 'cache_check', { hit: false }), T0 + 100)
    store().addEvent(event('req_success', 'route', { provider: 'groq' }), T0 + 200)
    store().addEvent(event('req_success', 'call', { provider: 'groq' }), T0 + 300)
    store().addEvent(
      event('req_success', 'complete', { provider_used: 'groq', status: 'success' }),
      T0 + 400,
    )

    const trace = store().traces.req_success
    expect(trace.provider).toBe('groq')
    expect(trace.didFallback).toBe(false)
    expect(trace.cacheHit).toBe(false)
    expect(trace.isComplete).toBe(true)
  })

  it('drives a fallback trace onto the second provider', () => {
    store().addEvent(event('req_fallback', 'route', { provider: 'cerebras' }), T0)
    store().addEvent(event('req_fallback', 'call', { provider: 'cerebras' }), T0 + 100)
    store().addEvent(
      event('req_fallback', 'fallback', { from: 'cerebras', to: 'gemini' }),
      T0 + 200,
    )
    store().addEvent(
      event('req_fallback', 'complete', { provider_used: 'gemini', status: 'success' }),
      T0 + 300,
    )

    const trace = store().traces.req_fallback
    expect(trace.didFallback).toBe(true)
    expect(trace.skipped).toEqual(['cerebras'])
    expect(trace.provider).toBe('gemini')
    expect(trace.isComplete).toBe(true)
  })

  it('treats a cache hit as terminal, since the stream sends no complete frame', () => {
    // Verbatim live shape: classify, then `cache` with a string verdict, stop.
    store().addEvent(event('req_hit', 'classify', { classification: 'simple' }), T0)
    store().addEvent(event('req_hit', 'cache_check', { result: 'hit' }), T0 + 100)

    const trace = store().traces.req_hit
    expect(trace.cacheHit).toBe(true)
    expect(trace.isComplete).toBe(true)
    expect(trace.completedAt).toBe(T0 + 100)

    // ...so it is evicted on the completed-trace clock, not the 60s stale one.
    store().sweep(T0 + 100 + COMPLETED_TTL_MS)
    expect(store().traces.req_hit).toBeUndefined()
  })

  it('leaves a cache miss in flight', () => {
    store().addEvent(event('req_miss', 'cache_check', { result: 'miss' }), T0)

    expect(store().traces.req_miss.cacheHit).toBe(false)
    expect(store().traces.req_miss.isComplete).toBe(false)
  })

  it('drives a cache-hit trace with no route, call or provider', () => {
    store().addEvent(event('req_cached', 'classify', { classification: 'simple' }), T0)
    store().addEvent(event('req_cached', 'cache_check', { hit: true }), T0 + 100)
    store().addEvent(
      event('req_cached', 'complete', { provider_used: null, status: 'cached' }),
      T0 + 200,
    )

    const trace = store().traces.req_cached
    expect(trace.cacheHit).toBe(true)
    expect(trace.provider).toBeNull()
    expect(trace.events.map((entry) => entry.stage)).toEqual([
      'classify',
      'cache_check',
      'complete',
    ])
  })
})

describe('stream gap on reconnect', () => {
  it('puts in-flight requests at risk but leaves completed ones alone', () => {
    feed('req_live', ['classify', 'route'])
    feed('req_done', ['classify', 'complete'])

    store().markStreamGap(T0 + 1_000)

    expect(store().traces.req_live.atRiskSince).toBe(T0 + 1_000)
    expect(store().traces.req_done.atRiskSince).toBeNull()
  })

  it('clears the risk when the request keeps emitting across the gap', () => {
    feed('req_live', ['classify', 'route'])
    store().markStreamGap(T0 + 1_000)

    store().addEvent(event('req_live', 'call', { provider: 'groq' }), T0 + 1_200)

    expect(store().traces.req_live.atRiskSince).toBeNull()
    expect(store().traces.req_live.isInterrupted).toBe(false)

    // ...and it survives a sweep well past the grace period.
    store().sweep(T0 + 1_200 + INTERRUPT_GRACE_MS + 1)
    expect(store().traces.req_live).toBeDefined()
    expect(store().traces.req_live.isInterrupted).toBe(false)
  })

  it('marks a silent request interrupted once the grace period lapses', () => {
    feed('req_orphan', ['classify', 'route'])
    store().markStreamGap(T0 + 1_000)

    store().sweep(T0 + 1_000 + INTERRUPT_GRACE_MS - 1)
    expect(store().traces.req_orphan.isInterrupted).toBe(false)

    store().sweep(T0 + 1_000 + INTERRUPT_GRACE_MS)
    expect(store().traces.req_orphan.isInterrupted).toBe(true)
    expect(store().traces.req_orphan.atRiskSince).toBeNull()
  })

  it('evicts an interrupted request instead of animating it forever', () => {
    feed('req_orphan', ['classify', 'route'])
    store().markStreamGap(T0 + 1_000)

    const markedAt = T0 + 1_000 + INTERRUPT_GRACE_MS
    store().sweep(markedAt)
    expect(store().traces.req_orphan).toBeDefined()

    store().sweep(markedAt + INTERRUPTED_TTL_MS)
    expect(store().traces.req_orphan).toBeUndefined()
    expect(store().order).not.toContain('req_orphan')
  })

  it('does not restamp a request that is already at risk', () => {
    feed('req_live', ['classify'])

    store().markStreamGap(T0 + 1_000)
    store().markStreamGap(T0 + 2_000)

    expect(store().traces.req_live.atRiskSince).toBe(T0 + 1_000)
  })

  it('is a no-op when nothing is in flight', () => {
    feed('req_done', ['classify', 'complete'])
    const before = store().traces

    store().markStreamGap(T0 + 1_000)
    expect(store().traces).toBe(before)
  })
})

describe('eviction', () => {
  it('keeps a completed trace through its grace period', () => {
    feed('req_a', ['classify', 'complete'])
    const completedAt = store().traces.req_a.completedAt!

    store().sweep(completedAt + COMPLETED_TTL_MS - 1)
    expect(store().traces.req_a).toBeDefined()
  })

  it('removes a completed trace from state once the grace period elapses', () => {
    feed('req_a', ['classify', 'complete'])
    const completedAt = store().traces.req_a.completedAt!

    store().sweep(completedAt + COMPLETED_TTL_MS)

    expect(store().traces.req_a).toBeUndefined()
    expect(store().order).not.toContain('req_a')
    expect(selectActiveTraces(store())).toHaveLength(0)
  })

  it('leaves in-flight traces alone while evicting completed ones', () => {
    feed('req_done', ['classify', 'complete'])
    feed('req_live', ['classify', 'route'], T0 + 50)

    store().sweep(T0 + COMPLETED_TTL_MS + 1_000)

    expect(store().traces.req_done).toBeUndefined()
    expect(store().traces.req_live).toBeDefined()
  })

  it('drops a trace that goes silent without completing', () => {
    feed('req_stalled', ['classify', 'route'])
    const lastSeen = store().traces.req_stalled.updatedAt

    store().sweep(lastSeen + STALE_TTL_MS - 1)
    expect(store().traces.req_stalled).toBeDefined()

    store().sweep(lastSeen + STALE_TTL_MS)

    expect(store().traces.req_stalled).toBeUndefined()
    expect(store().order).toHaveLength(0)
  })

  it('pins the inspected trace so the panel does not blank mid-read', () => {
    feed('req_a', ['classify', 'complete'])
    store().selectRequest('req_a')

    store().sweep(T0 + COMPLETED_TTL_MS + 10_000)
    expect(store().traces.req_a).toBeDefined()

    // ...and releases it the moment the selection moves on.
    store().selectRequest(null)
    store().sweep(T0 + COMPLETED_TTL_MS + 10_000)
    expect(store().traces.req_a).toBeUndefined()
  })

  it('is a no-op when nothing has expired', () => {
    feed('req_a', ['classify'])
    const before = store().traces

    store().sweep(T0 + 10)
    expect(store().traces).toBe(before)
  })

  it('bounds state at the hard cap even if nothing ever completes', () => {
    for (let index = 0; index < MAX_TRACES + 12; index += 1) {
      store().addEvent(event(`req_${index}`, 'classify'), T0 + index)
    }

    expect(store().order).toHaveLength(MAX_TRACES)
    expect(Object.keys(store().traces)).toHaveLength(MAX_TRACES)
    // Oldest go first.
    expect(store().traces.req_0).toBeUndefined()
    expect(store().traces[`req_${MAX_TRACES + 11}`]).toBeDefined()
  })

  it('clear() empties everything, including the selection', () => {
    feed('req_a', ['classify'])
    store().selectRequest('req_a')

    store().clear()

    expect(store().traces).toEqual({})
    expect(store().order).toEqual([])
    expect(store().selectedRequestId).toBeNull()
  })
})
