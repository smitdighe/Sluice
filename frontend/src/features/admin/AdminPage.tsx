import { PageHeader } from '@/app/layout/PageHeader'
import { EmptyState, ErrorState } from '@/components/feedback/QueryStates'
import { Skeleton } from '@/components/ui'
import { CacheStatsCard } from '@/features/admin/CacheStatsCard'
import { CircuitBreakerCard } from '@/features/admin/CircuitBreakerCard'
import { QuotaGauge } from '@/features/admin/QuotaGauge'
import { QuotaHistoryChart } from '@/features/admin/QuotaHistoryChart'
import {
  PROVIDER_POLL_MS,
  useCacheStats,
  useProviderStates,
  useQuota,
} from '@/features/admin/hooks/useAdminData'
import type { ProviderState } from '@/features/admin/types'

/**
 * Three columns, one per provider. A 4-column track would leave the row
 * visibly short now that Ollama is gone.
 */
const PROVIDER_GRID = 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3'

function SkeletonGrid({ count }: { count: number }) {
  return (
    <div className={PROVIDER_GRID}>
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="h-32 w-full" />
      ))}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="space-y-3">
      <h2 className="font-mono text-2xs tracking-widest text-content-faint uppercase">
        {title}
      </h2>
      {children}
    </section>
  )
}

/**
 * Bento grid of the admin surfaces.
 *
 * Each panel owns its own loading/error/empty state, so one failing endpoint
 * degrades a single tile instead of blanking the page. Quota, providers and
 * cache each poll on their own cadence — see `hooks/useAdminData.ts`.
 */
export function AdminPage() {
  const quotaQuery = useQuota()
  const providersQuery = useProviderStates()
  const cacheQuery = useCacheStats()

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Admin"
        description={`Quota, provider circuits and cache. Provider state refreshes every ${PROVIDER_POLL_MS / 1000}s.`}
      />

      <CircuitAnnouncer states={providersQuery.data} />

      <Section title="Provider circuits">
        {providersQuery.isPending && <SkeletonGrid count={3} />}
        {providersQuery.isError && (
          <ErrorState
            error={providersQuery.error}
            title="Could not load provider states"
            onRetry={() => void providersQuery.refetch()}
          />
        )}
        {providersQuery.isSuccess && providersQuery.data.length === 0 && (
          <EmptyState title="No providers reported." />
        )}
        {providersQuery.isSuccess && providersQuery.data.length > 0 && (
          <div className={PROVIDER_GRID}>
            {providersQuery.data.map((state) => (
              <CircuitBreakerCard key={state.provider} state={state} />
            ))}
          </div>
        )}
      </Section>

      <Section title="Quota">
        {quotaQuery.isPending && <SkeletonGrid count={3} />}
        {quotaQuery.isError && (
          <ErrorState
            error={quotaQuery.error}
            title="Could not load quota"
            onRetry={() => void quotaQuery.refetch()}
          />
        )}
        {quotaQuery.isSuccess && quotaQuery.data.length === 0 && (
          <EmptyState title="No quota records yet.">
            Quota rows appear once a billing period has usage.
          </EmptyState>
        )}
        {quotaQuery.isSuccess && quotaQuery.data.length > 0 && (
          <div className={PROVIDER_GRID}>
            {quotaQuery.data.map((entry) => (
              <QuotaGauge key={entry.provider} entry={entry} />
            ))}
          </div>
        )}
      </Section>

      <Section title="Cache">
        {cacheQuery.isPending && <Skeleton className="h-32 w-full" />}
        {cacheQuery.isError && (
          <ErrorState
            error={cacheQuery.error}
            title="Could not load cache stats"
            onRetry={() => void cacheQuery.refetch()}
          />
        )}
        {cacheQuery.isSuccess && <CacheStatsCard stats={cacheQuery.data} />}
      </Section>

      <Section title="History">
        <QuotaHistoryChart />
      </Section>
    </div>
  )
}

/**
 * Announces circuit-breaker changes to a screen reader.
 *
 * A sighted user notices a card turning red on the next 5s poll; without this,
 * nobody else does. The announcement is derived purely from the states, so an
 * unchanged poll renders an identical string and stays silent — the live
 * region fires on transitions, not on ticks. Quota and cache are deliberately
 * excluded: they drift continuously and would talk forever.
 */
function CircuitAnnouncer({ states }: { states: ProviderState[] | undefined }) {
  const summary = states
    ?.map((state) => `${state.provider} ${state.circuit_state.replace('_', ' ')}`)
    .join(', ')

  return (
    <span role="status" aria-live="polite" className="sr-only">
      {summary ? `Provider circuits: ${summary}.` : ''}
    </span>
  )
}
