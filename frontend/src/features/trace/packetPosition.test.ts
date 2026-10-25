import { describe, expect, it } from 'vitest'

import { packetNodeId } from '@/features/trace/lib/packetPosition'
import type { RequestTrace } from '@/features/trace/store/traceStore'
import type { Provider, TraceStage } from '@/types/enums'

function trace(stage: TraceStage, provider: Provider | null = null): RequestTrace {
  return {
    requestId: 'req_test',
    events: [],
    currentStage: stage,
    provider,
    skippedProvider: null,
    skipped: [],
    didFallback: false,
    cacheHit: false,
    isComplete: stage === 'complete',
    isInterrupted: false,
    interruptedAt: null,
    atRiskSince: null,
    startedAt: 0,
    updatedAt: 0,
    completedAt: null,
    revision: 1,
  }
}

describe('packetNodeId', () => {
  it('maps each pipeline stage to its own node', () => {
    expect(packetNodeId(trace('classify'))).toBe('classify')
    expect(packetNodeId(trace('cache_check'))).toBe('cache_check')
    expect(packetNodeId(trace('route'))).toBe('route')
    expect(packetNodeId(trace('complete'))).toBe('complete')
  })

  it('resolves call and fallback onto the targeted provider node', () => {
    expect(packetNodeId(trace('call', 'groq'))).toBe('provider:groq')
    expect(packetNodeId(trace('fallback', 'gemini'))).toBe('provider:gemini')
  })

  it('holds at route when no event has named a provider', () => {
    expect(packetNodeId(trace('call'))).toBe('route')
    expect(packetNodeId(trace('fallback'))).toBe('route')
  })

  it('sends a cache hit to the terminus without touching a provider', () => {
    const cached = { ...trace('complete'), cacheHit: true }
    expect(packetNodeId(cached)).toBe('complete')
  })

  it('sends a completed request to the terminus whatever stage it ended on', () => {
    // The live stream ends a cache hit on `cache_check` with no `complete`
    // frame; the packet still has to arrive somewhere to fade out.
    const endedOnCache = { ...trace('cache_check'), cacheHit: true, isComplete: true }
    expect(packetNodeId(endedOnCache)).toBe('complete')
  })
})
