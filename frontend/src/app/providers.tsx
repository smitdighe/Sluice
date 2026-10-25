import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { queryClient } from '@/lib/queryClient'

export interface AppProvidersProps {
  children: ReactNode
}

/**
 * The single mount point for every app-wide provider.
 *
 * `QueryClientProvider` lives here and nowhere else — `main.tsx` used to mount
 * its own in Phase 2 and no longer does. The client itself is instantiated in
 * `lib/queryClient.ts` (module scope, so it survives re-renders) and imported
 * rather than constructed here.
 */
export function AppProviders({ children }: AppProvidersProps) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
