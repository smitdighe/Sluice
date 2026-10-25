import { memo } from 'react'

import { Badge, Card, Stat } from '@/components/ui'
import type { BadgeStatus } from '@/components/ui'
import type { CircuitState, ProviderState } from '@/features/admin/types'

export interface CircuitBreakerCardProps {
  state: ProviderState
}

/** The three circuit states map 1:1 onto the Phase 1 semantic tokens. */
const CIRCUIT_BADGE: Record<CircuitState, BadgeStatus> = {
  closed: 'closed',
  open: 'open',
  half_open: 'half_open',
}

/**
 * Memoised against the 5s provider poll. TanStack Query's structural sharing
 * keeps `state` referentially identical when the numbers have not moved, so an
 * unchanged provider costs nothing on a tick where another one changed.
 */
export const CircuitBreakerCard = memo(function CircuitBreakerCard({
  state,
}: CircuitBreakerCardProps) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-sm text-content-primary">{state.provider}</p>
        <Badge status={CIRCUIT_BADGE[state.circuit_state]} dot>
          {state.circuit_state}
        </Badge>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Stat
          label="rate limit left"
          value={state.rate_limit_remaining.toLocaleString()}
        />
        <Stat label="errors" value={state.error_count.toLocaleString()} />
      </div>
    </Card>
  )
})
