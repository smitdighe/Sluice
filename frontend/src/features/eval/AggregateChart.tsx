import { memo, useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { EmptyState } from '@/components/feedback/QueryStates'
import { Card } from '@/components/ui'
import { transformScoresByProvider } from '@/features/eval/scoresByProvider.transform'
import type { EvalScore } from '@/features/eval/types'
import { useReducedMotion } from '@/hooks/useReducedMotion'

export interface AggregateChartProps {
  scores: EvalScore[]
}

/* Design tokens are CSS variables at runtime; Recharts needs literal colours,
   so the three metric hues are pinned here to match the Phase 1 palette. */
const METRIC_COLORS = {
  relevance: '#5aa9ff',
  coherence: '#8b7dff',
  correctness: '#3ecf8e',
} as const

/* Mirrors `content.muted` — axis ticks are text and owe AA. */
const AXIS_COLOR = '#94a0b2'
const GRID_COLOR = '#242a33'

export const AggregateChart = memo(function AggregateChart({
  scores,
}: AggregateChartProps) {
  const prefersReducedMotion = useReducedMotion()

  // The pivot itself lives in a pure module — this component only renders it.
  // Memoised because sorting the table below re-renders this whole page, and
  // the pivot does not depend on the sort.
  const data = useMemo(() => transformScoresByProvider(scores), [scores])

  if (data.length === 0) {
    return <EmptyState title="No per-prompt scores in this run." />
  }

  return (
    <Card>
      <h2 className="font-mono text-2xs tracking-widest text-content-faint uppercase">
        Mean score by provider
      </h2>

      <div className="mt-4 h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
            <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="provider"
              stroke={AXIS_COLOR}
              tick={{ fontSize: 11, fill: AXIS_COLOR }}
              tickLine={false}
            />
            {/* Domain is derived, not pinned to [0,1] — the score scale is
                not fixed by the contract. */}
            <YAxis
              domain={[0, 'auto']}
              stroke={AXIS_COLOR}
              tick={{ fontSize: 11, fill: AXIS_COLOR }}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: 'rgba(90, 169, 255, 0.06)' }}
              contentStyle={{
                background: '#171b21',
                border: '1px solid #242a33',
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: '#e7ebf0' }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {/* Recharts grows bars from zero on mount — a JS animation the CSS
                reduced-motion guard cannot reach, so it is disabled here. */}
            {(['relevance', 'coherence', 'correctness'] as const).map((metric) => (
              <Bar
                key={metric}
                dataKey={metric}
                fill={METRIC_COLORS[metric]}
                radius={[3, 3, 0, 0]}
                isAnimationActive={!prefersReducedMotion}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* scored/total, because an unscored prompt still counts as a sample
          but contributes nothing to the bars above. */}
      <p className="mt-2 font-mono text-2xs text-content-faint">
        {data
          .map((row) => `${row.provider}: ${row.scoredCount}/${row.sampleCount} scored`)
          .join('  ·  ')}
      </p>
    </Card>
  )
})
