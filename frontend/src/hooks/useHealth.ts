import { useQuery } from '@tanstack/react-query'

import type { ApiClientError } from '@/api/client'
import { getHealth } from '@/api/healthApi'
import type { Health } from '@/api/schemas'

/**
 * App-wide liveness poll behind the top-bar indicator.
 *
 * Lives outside `features/` because it is shell state: every route shows it,
 * and no feature owns it.
 */

export const HEALTH_POLL_MS = 10_000

export const healthKeys = {
  health: ['health'] as const,
}

export function useHealth() {
  return useQuery<Health, ApiClientError>({
    queryKey: healthKeys.health,
    queryFn: ({ signal }) => getHealth(signal),
    refetchInterval: HEALTH_POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: HEALTH_POLL_MS,
    /**
     * No retries. A failure here *is* the answer the indicator wants, and the
     * next poll is only 10s away — retrying would triple the request rate and
     * the console noise for the entire time the backend is down.
     */
    retry: false,
  })
}
