import { describe, expect, it } from 'vitest'

import type { ProviderState } from '@/api/schemas'
import { toProviderCircuitStates } from '@/features/trace/lib/providerCircuitStates'

const row = (
  provider: string,
  circuitState: ProviderState['circuit_state'],
): ProviderState => ({
  provider,
  circuit_state: circuitState,
  rate_limit_remaining: 30,
  error_count: 0,
})

describe('toProviderCircuitStates', () => {
  it('returns undefined before the query has data, so nodes stay neutral', () => {
    expect(toProviderCircuitStates(undefined)).toBeUndefined()
  })

  it('maps every known provider to its circuit state', () => {
    expect(
      toProviderCircuitStates([
        row('groq', 'closed'),
        row('cerebras', 'open'),
        row('gemini', 'half_open'),
      ]),
    ).toEqual({ groq: 'closed', cerebras: 'open', gemini: 'half_open' })
  })

  it('drops rows for providers the graph has no node for', () => {
    expect(
      toProviderCircuitStates([row('ollama', 'closed'), row('groq', 'open')]),
    ).toEqual({
      groq: 'open',
    })
  })

  it('returns an empty lookup for an empty response rather than undefined', () => {
    expect(toProviderCircuitStates([])).toEqual({})
  })
})
