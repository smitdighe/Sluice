import { QueryClient } from '@tanstack/react-query'

import { isApiClientError } from '@/api/client'

const MAX_QUERY_RETRIES = 2

/**
 * Shared query client.
 *
 * Retry policy: only transport-level failures are worth repeating. A 4xx, a
 * cancelled request, or a response that failed schema validation will fail
 * identically on the second attempt, so those short-circuit.
 *
 * Polling intervals are deliberately absent here: they belong to the query
 * that polls, because the right cadence is a property of how fast that
 * endpoint's data can change. See `features/admin/hooks/useAdminData.ts` and
 * `hooks/useHealth.ts`, which also opt out of this retry policy — a query that
 * runs again in seconds does not need to retry.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (isApiClientError(error)) {
          if (error.type === 'invalid_response' || error.type === 'canceled') return false
          if (error.status !== undefined && error.status >= 400 && error.status < 500) {
            return false
          }
        }
        return failureCount < MAX_QUERY_RETRIES
      },
    },
    mutations: {
      retry: false,
    },
  },
})
