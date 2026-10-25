import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { PageHeader } from '@/app/layout/PageHeader'
import { EmptyState, ErrorState, LoadingRows } from '@/components/feedback/QueryStates'
import { Badge, Button, Card, Skeleton, Stat } from '@/components/ui'
import { AggregateChart } from '@/features/eval/AggregateChart'
import { useEvalRun } from '@/features/eval/hooks/useEvalRuns'
import { RUN_STATUS_BADGE } from '@/features/eval/runStatusBadge'
import type { EvalAggregates, EvalScore } from '@/features/eval/types'
import { cn } from '@/lib/cn'

type SortKey = 'provider' | 'prompt' | 'relevance' | 'coherence' | 'correctness'
type SortDirection = 'asc' | 'desc'

const AGGREGATE_LABELS: { key: keyof EvalAggregates; label: string }[] = [
  { key: 'relevance_mean', label: 'Relevance' },
  { key: 'coherence_mean', label: 'Coherence' },
  { key: 'correctness_mean', label: 'Correctness' },
  { key: 'pass_rate', label: 'Pass rate' },
]

/**
 * A metric is `null` when the judge could not score that prompt. Render it as
 * an em dash — visibly "not scored", never "0.000".
 */
function formatMetric(value: number | null): string {
  return value === null ? '—' : value.toFixed(3)
}

/** Aggregate headline. Same `Stat` atom as the rest of the app, one size up. */
function StatCard({ label, value }: { label: string; value: number | null }) {
  const missing = value === null

  return (
    <Card>
      <Stat
        label={label}
        value={formatMetric(value)}
        muted={missing}
        size="lg"
        title={missing ? 'Not scored' : undefined}
      />
    </Card>
  )
}

function sortScores(
  scores: EvalScore[],
  key: SortKey,
  direction: SortDirection,
): EvalScore[] {
  const factor = direction === 'asc' ? 1 : -1

  return [...scores].sort((a, b) => {
    const left = a[key]
    const right = b[key]

    // Unscored rows sort to the bottom in both directions — they carry no
    // ranking information, so they should never displace real results.
    if (left === null && right === null) return 0
    if (left === null) return 1
    if (right === null) return -1

    if (typeof left === 'number' && typeof right === 'number') {
      return (left - right) * factor
    }
    return String(left).localeCompare(String(right)) * factor
  })
}

export function EvalDetailPage() {
  const { runId } = useParams<{ runId: string }>()
  const runQuery = useEvalRun(runId)

  const [sortKey, setSortKey] = useState<SortKey>('provider')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  const run = runQuery.data
  const sortedScores = useMemo(
    () => (run ? sortScores(run.scores, sortKey, sortDirection) : []),
    [run, sortKey, sortDirection],
  )

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDirection('asc')
  }

  const isWaiting = run?.status === 'queued' || run?.status === 'running'

  return (
    <section className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <PageHeader
        title={<span className="break-all">{runId}</span>}
        eyebrow={
          <Link
            to="/eval"
            className="font-mono text-2xs tracking-wide text-content-muted uppercase hover:text-content-secondary"
          >
            ← All runs
          </Link>
        }
      >
        {run && (
          <Badge status={RUN_STATUS_BADGE[run.status]} size="md" dot>
            {run.status}
          </Badge>
        )}
      </PageHeader>

      {runQuery.isPending && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-24 w-full" />
            ))}
          </div>
          <LoadingRows rows={4} />
        </>
      )}

      {runQuery.isError && (
        <ErrorState
          error={runQuery.error}
          title="Could not load this run"
          onRetry={() => void runQuery.refetch()}
        />
      )}

      {run && isWaiting && (
        <EmptyState title={`This run is ${run.status}.`}>
          Aggregates and scores appear once it finishes — reload in a moment.
        </EmptyState>
      )}

      {run && run.status === 'failed' && (
        <EmptyState title="This run failed.">
          No aggregates were produced. Queue a new run from the list.
        </EmptyState>
      )}

      {run && run.status === 'complete' && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {AGGREGATE_LABELS.map(({ key, label }) => (
              <StatCard key={key} label={label} value={run.aggregates[key]} />
            ))}
          </div>

          <AggregateChart scores={run.scores} />

          {run.scores.length === 0 ? (
            <EmptyState title="This run recorded no per-prompt scores." />
          ) : (
            <Card padding="none" className="overflow-x-auto">
              {/* Five columns including free-text prompts; the floor is what
                  turns the wrapper's `overflow-x-auto` into real horizontal
                  scrolling instead of five crushed columns at 375px. */}
              <table className="w-full min-w-[44rem] text-sm">
                <caption className="sr-only">
                  Per-prompt judge scores. Column headers are buttons that sort the table;
                  unscored prompts always sort last.
                </caption>
                <thead>
                  <tr className="border-b border-surface-line text-left">
                    {(
                      [
                        ['provider', 'Provider'],
                        ['prompt', 'Prompt'],
                        ['relevance', 'Relevance'],
                        ['coherence', 'Coherence'],
                        ['correctness', 'Correctness'],
                      ] as [SortKey, string][]
                    ).map(([key, label]) => (
                      <th
                        key={key}
                        scope="col"
                        // Announces both which column is sorted and which way,
                        // which the arrow glyph alone did not.
                        aria-sort={
                          sortKey === key
                            ? sortDirection === 'asc'
                              ? 'ascending'
                              : 'descending'
                            : 'none'
                        }
                        className="px-4 py-3"
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleSort(key)}
                          className="px-0 font-mono text-2xs tracking-wide text-content-faint uppercase hover:bg-transparent"
                        >
                          {label}
                          {sortKey === key && (
                            <span aria-hidden="true">
                              {sortDirection === 'asc' ? '↑' : '↓'}
                            </span>
                          )}
                        </Button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedScores.map((score, index) => (
                    <tr
                      key={`${score.provider}-${score.prompt}-${index}`}
                      className="border-b border-surface-line/60 last:border-0"
                    >
                      <td className="px-4 py-3">
                        <Badge status="neutral">{score.provider}</Badge>
                      </td>
                      <td
                        className="max-w-md truncate px-4 py-3 text-content-secondary"
                        title={score.prompt}
                      >
                        {score.prompt}
                      </td>
                      {(
                        [score.relevance, score.coherence, score.correctness] as const
                      ).map((metric, metricIndex) => (
                        <td
                          key={metricIndex}
                          className={cn(
                            'px-4 py-3 font-mono',
                            metric === null
                              ? 'text-content-faint'
                              : 'text-content-primary',
                          )}
                          title={metric === null ? 'Not scored' : undefined}
                        >
                          {formatMetric(metric)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </section>
  )
}
