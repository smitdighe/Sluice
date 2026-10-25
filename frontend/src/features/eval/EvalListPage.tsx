import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { PageHeader } from '@/app/layout/PageHeader'
import { EmptyState, ErrorState, LoadingRows } from '@/components/feedback/QueryStates'
import { Badge, Button, Card } from '@/components/ui'
import { useEvalRuns, useRunEval } from '@/features/eval/hooks/useEvalRuns'
import { RUN_STATUS_BADGE } from '@/features/eval/runStatusBadge'

const PAGE_SIZE = 20

export function EvalListPage() {
  const navigate = useNavigate()
  const [offset, setOffset] = useState(0)

  const runsQuery = useEvalRuns({ limit: PAGE_SIZE, offset })
  // Invalidates the run list on success (see useRunEval), so the queued run
  // shows up without a manual refresh.
  const runEval = useRunEval()

  const total = runsQuery.data?.total ?? 0
  const items = runsQuery.data?.items ?? []
  const hasPrev = offset > 0
  const hasNext = offset + PAGE_SIZE < total

  return (
    <section className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <PageHeader title="Eval Runs" description="Scored batches across providers.">
        <Button onClick={() => runEval.mutate(undefined)} disabled={runEval.isPending}>
          {runEval.isPending ? 'Queueing…' : 'Run Eval'}
        </Button>
      </PageHeader>

      {runEval.isError && (
        <ErrorState error={runEval.error} title="Could not queue a run" />
      )}

      {runsQuery.isPending && <LoadingRows rows={5} />}

      {runsQuery.isError && (
        <ErrorState
          error={runsQuery.error}
          title="Could not load runs"
          onRetry={() => void runsQuery.refetch()}
        />
      )}

      {runsQuery.isSuccess && items.length === 0 && (
        <EmptyState
          title="No eval runs yet."
          action={
            <Button
              onClick={() => runEval.mutate(undefined)}
              disabled={runEval.isPending}
            >
              Run the first one
            </Button>
          }
        >
          Queue a run to score the providers against the prompt set.
        </EmptyState>
      )}

      {runsQuery.isSuccess && items.length > 0 && (
        <>
          <Card padding="none" className="overflow-x-auto">
            {/*
             * `min-w` is what makes the wrapper's `overflow-x-auto` do
             * anything: a `w-full` table just compresses to the container and
             * the run id column collapses to one character per line at 375px.
             * With a floor, the table scrolls sideways instead — the standard
             * data-table answer, and better here than collapsing columns,
             * since there are only three and all three matter.
             */}
            <table className="w-full min-w-[30rem] text-sm">
              <caption className="sr-only">
                Eval runs, newest first. Each row links to that run&apos;s scores.
              </caption>
              <thead>
                <tr className="border-b border-surface-line text-left">
                  <th
                    scope="col"
                    className="px-4 py-3 font-mono text-2xs tracking-wide text-content-faint uppercase"
                  >
                    Run ID
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 font-mono text-2xs tracking-wide text-content-faint uppercase"
                  >
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((run) => (
                  <tr
                    key={run.run_id}
                    onClick={() => void navigate(`/eval/${run.run_id}`)}
                    className="cursor-pointer border-b border-surface-line/60 last:border-0 hover:bg-surface-overlay"
                  >
                    <td className="px-4 py-3 font-mono text-content-primary">
                      {run.run_id}
                    </td>
                    <td className="px-4 py-3">
                      <Badge status={RUN_STATUS_BADGE[run.status]} dot>
                        {run.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {/* The row click is a pointer shortcut; this button is
                          the keyboard path, so its name has to identify the
                          row rather than say "View" four times in a row. */}
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`View run ${run.run_id}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          void navigate(`/eval/${run.run_id}`)
                        }}
                      >
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-2xs text-content-faint">
              {offset + 1}–{Math.min(offset + items.length, total)} of {total}
            </span>
            <div className="flex-1" />
            <Button
              variant="secondary"
              size="sm"
              disabled={!hasPrev}
              onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!hasNext}
              onClick={() => setOffset((value) => value + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
