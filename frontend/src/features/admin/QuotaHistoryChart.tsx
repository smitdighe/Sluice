import { memo, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { EmptyState, ErrorState } from '@/components/feedback/QueryStates'
import { Card, Skeleton } from '@/components/ui'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { useQuotaHistory } from '@/features/admin/hooks/useAdminData'
import {
  defaultHistoryRange,
  transformQuotaHistory,
} from '@/features/admin/quotaHistory.transform'
import { cn } from '@/lib/cn'

/* Fixed hues so a provider keeps its colour between renders. */
const SERIES_COLORS = ['#5aa9ff', '#3ecf8e', '#f0a92c', '#8b7dff', '#ff5d5d']
/* Mirrors `content.muted`. Axis ticks are text and owe AA — the previous
   value was the pre-Phase-7 muted grey, which measured 4.27:1. */
const AXIS_COLOR = '#94a0b2'
const GRID_COLOR = '#242a33'

/** `datetime-local` inputs want `YYYY-MM-DDTHH:mm` in local time. */
function toLocalInputValue(iso: string): string {
  const date = new Date(iso)
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function fromLocalInputValue(value: string): string {
  return new Date(value).toISOString()
}

/**
 * Memoised with no props, which makes it inert to its parent.
 *
 * `AdminPage` re-renders on every provider (5s), quota (15s) and cache (30s)
 * tick. This chart's own query is a range over closed periods and is not
 * polled at all, so without the guard Recharts was re-laying out an unchanged
 * 200-point line chart several times a minute — the visible jank the sweep was
 * looking for. Now it re-renders only when its own range or query changes.
 */
export const QuotaHistoryChart = memo(function QuotaHistoryChart() {
  const prefersReducedMotion = useReducedMotion()

  // Default window: the last 24 hours, computed once on mount.
  const [range, setRange] = useState(() => defaultHistoryRange())

  // 200 is the backend's documented ceiling for `limit`; asking for more is a 422.
  const historyQuery = useQuotaHistory({ start: range.start, end: range.end, limit: 200 })

  const { rows, providers } = useMemo(
    () => transformQuotaHistory(historyQuery.data?.items ?? []),
    [historyQuery.data],
  )

  return (
    <Card>
      <div className="flex flex-wrap items-end gap-3">
        {/* Full-width below `sm` so the two pickers get the next line to
            themselves — sharing it with the title left them ~96px each, which
            is under what a `datetime-local` control needs to show its value. */}
        <h2 className="w-full font-mono text-2xs tracking-widest text-content-faint uppercase sm:w-auto">
          Quota history
        </h2>
        <div className="hidden flex-1 sm:block" />

        {/* The two pickers share a row and grow to fill it at 375px, where a
            `datetime-local` control is close to half the viewport on its own. */}
        {(['start', 'end'] as const).map((bound) => (
          <label key={bound} className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-none">
            <span className="font-mono text-2xs tracking-wide text-content-faint uppercase">
              {bound}
            </span>
            <input
              type="datetime-local"
              value={toLocalInputValue(range[bound])}
              onChange={(event) => {
                if (!event.target.value) return
                setRange((current) => ({
                  ...current,
                  [bound]: fromLocalInputValue(event.target.value),
                }))
              }}
              className={cn(
                'w-full min-w-0 rounded-control border border-surface-line bg-surface-inset px-2 py-1',
                'font-mono text-xs text-content-primary sm:w-auto',
              )}
            />
          </label>
        ))}
      </div>

      <div className="mt-4">
        {historyQuery.isPending && <Skeleton className="h-64 w-full" />}

        {historyQuery.isError && (
          <ErrorState
            error={historyQuery.error}
            title="Could not load quota history"
            onRetry={() => void historyQuery.refetch()}
          />
        )}

        {historyQuery.isSuccess && rows.length === 0 && (
          <EmptyState title="No quota data in this window.">
            Widen the range, or wait for the first usage period to close.
          </EmptyState>
        )}

        {historyQuery.isSuccess && rows.length > 0 && (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 4, left: -12 }}>
                <CartesianGrid
                  stroke={GRID_COLOR}
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="time"
                  type="number"
                  scale="time"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(value: number) =>
                    new Date(value).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  }
                  stroke={AXIS_COLOR}
                  tick={{ fontSize: 11, fill: AXIS_COLOR }}
                  tickLine={false}
                />
                <YAxis
                  stroke={AXIS_COLOR}
                  tick={{ fontSize: 11, fill: AXIS_COLOR }}
                  tickLine={false}
                />
                <Tooltip
                  labelFormatter={(label) =>
                    typeof label === 'number' ? new Date(label).toLocaleString() : ''
                  }
                  contentStyle={{
                    background: '#171b21',
                    border: '1px solid #242a33',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: '#e7ebf0' }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {providers.map((provider, index) => (
                  <Line
                    key={provider}
                    type="monotone"
                    dataKey={provider}
                    stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                    /* Recharts draws lines in by default. That is a JS
                       animation, so the CSS guard in `styles/index.css`
                       never sees it — it has to be switched off here. */
                    isAnimationActive={!prefersReducedMotion}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </Card>
  )
})
