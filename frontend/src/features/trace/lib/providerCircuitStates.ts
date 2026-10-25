import type { ProviderState } from '@/api/schemas'
import { PROVIDERS, type CircuitState, type Provider } from '@/types/enums'

/**
 * Admin provider rows → the lookup the canvas colours its nodes from.
 *
 * The wire types `provider` as a bare string, so a row naming something that
 * is not one of our three providers is dropped rather than rendered: the graph
 * has no node for it, and inventing one would contradict the model.
 */
export function toProviderCircuitStates(
  states: ProviderState[] | undefined,
): Partial<Record<Provider, CircuitState>> | undefined {
  if (!states) return undefined

  const known = new Set<string>(PROVIDERS)
  const lookup: Partial<Record<Provider, CircuitState>> = {}

  for (const state of states) {
    if (!known.has(state.provider)) continue
    lookup[state.provider as Provider] = state.circuit_state
  }

  return lookup
}
