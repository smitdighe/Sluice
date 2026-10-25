import { providerNodeId, type NodeId } from '@/features/trace/lib/graphModel'
import type { RequestTrace } from '@/features/trace/store/traceStore'

/**
 * Where a packet belongs for a given trace state.
 *
 * Lives here rather than beside the component because the canvas needs it too
 * — it is how a node knows whether it is holding anything.
 *
 * `call` and `fallback` are transitions onto a provider, not nodes of their
 * own: both resolve to the provider currently targeted. If no event has named
 * a provider yet (see the `detail` contract gap in `lib/traceDetail.ts`), the
 * packet holds at `route` rather than guessing a destination.
 */
export function packetNodeId(trace: RequestTrace): NodeId {
  // A finished request belongs at the terminus whatever its last stage was.
  // Matters for cache hits: the live stream ends them on `cache_check` with no
  // `complete` frame, and the packet still has to arrive somewhere to fade.
  if (trace.isComplete) return 'complete'

  switch (trace.currentStage) {
    case 'classify':
      return 'classify'
    case 'cache_check':
      return 'cache_check'
    case 'route':
      return 'route'
    case 'call':
    case 'fallback':
      return trace.provider ? providerNodeId(trace.provider) : 'route'
    case 'complete':
      return 'complete'
  }
}
