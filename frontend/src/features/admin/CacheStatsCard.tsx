import { memo } from 'react'

import { Card, Stat } from '@/components/ui'
import type { CacheStats } from '@/features/admin/types'

export interface CacheStatsCardProps {
  stats: CacheStats
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-control bg-surface-inset p-3">
      <Stat label={label} value={value} size="lg" />
    </div>
  )
}

/** Memoised against the 30s cache poll. */
export const CacheStatsCard = memo(function CacheStatsCard({
  stats,
}: CacheStatsCardProps) {
  return (
    <Card>
      {/* No heading of its own — `AdminPage` already titles this section
          "Cache", and the card was rendering the word twice. */}
      {/* Three tiles side by side need ~110px each; below `sm` they stack
          rather than clipping a six-digit entry count. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="hit rate" value={`${(stats.hit_rate * 100).toFixed(1)}%`} />
        <StatTile label="entries" value={stats.total_entries.toLocaleString()} />
        <StatTile label="avg hits" value={stats.avg_hit_count.toFixed(2)} />
      </div>
    </Card>
  )
})
