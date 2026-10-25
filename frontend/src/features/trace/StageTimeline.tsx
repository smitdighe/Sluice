import { Badge, Card } from '@/components/ui'
import type { RequestTrace, TraceTimelineEntry } from '@/features/trace/store/traceStore'
import { cn } from '@/lib/cn'
import type { TraceStage } from '@/types/enums'

/**
 * The inspector for one request.
 *
 * Deliberately plain. The canvas is where the visual budget goes; this is a
 * list of what happened, in order, with the raw `detail` bag on show — the
 * thing you read when the animation has already told you *that* something
 * happened and you need to know *what*.
 *
 * It is also the canvas's accessible equivalent, which is why it opens with a
 * one-line path summary rather than going straight to the timeline. The canvas
 * conveys the route at a glance; a screen reader user should get the same
 * shape in one sentence instead of having to assemble it from six rows.
 */

export interface StageTimelineProps {
  trace: RequestTrace | null
  /** Set while a request is selected, even if it has since been evicted. */
  selectedRequestId: string | null
  onClear: () => void
  className?: string
}

const STAGE_TONE: Record<TraceStage, string> = {
  classify: 'bg-content-faint',
  cache_check: 'bg-status-cached',
  route: 'bg-accent',
  call: 'bg-accent',
  fallback: 'bg-status-half_open',
  complete: 'bg-status-success',
}

/** Human-readable node names, matching the labels the canvas draws. */
const STAGE_LABEL: Record<TraceStage, string> = {
  classify: 'classify',
  cache_check: 'cache',
  route: 'route',
  call: 'call',
  fallback: 'fallback',
  complete: 'complete',
}

function formatOffset(ms: number): string {
  if (ms < 1000) return `+${Math.round(ms)}ms`
  return `+${(ms / 1000).toFixed(2)}s`
}

function formatClock(timestamp: string): string {
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) return timestamp
  return parsed.toISOString().slice(11, 23)
}

function formatValue(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/**
 * The request's route, as one sentence.
 *
 * Built from the timeline rather than from the stage list, so a request that
 * skipped `cache_check` or fell back twice reads accurately. Providers are
 * named inline because "call" alone does not say *who* was called — which is
 * the single most useful fact on this panel.
 */
function pathSummary(trace: RequestTrace): string {
  const steps: string[] = []

  for (const entry of trace.events) {
    if (entry.stage === 'call' || entry.stage === 'fallback') {
      const provider = trace.provider
      const named =
        entry.stage === 'fallback'
          ? `fallback${provider ? ` to ${provider}` : ''}`
          : `call${provider ? ` ${provider}` : ''}`
      steps.push(named)
      continue
    }
    steps.push(STAGE_LABEL[entry.stage])
  }

  if (steps.length === 0) return 'No stages recorded yet.'
  if (trace.cacheHit && !steps.includes('complete')) steps.push('served from cache')
  return steps.join(' then ')
}

function Frame({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <Card className={cn('overflow-y-auto', className)} padding="md">
      {children}
    </Card>
  )
}

export function StageTimeline({
  trace,
  selectedRequestId,
  onClear,
  className,
}: StageTimelineProps) {
  if (!trace) {
    return (
      <Frame className={className}>
        <h2 className="font-mono text-2xs tracking-widest text-content-faint uppercase">
          Inspector
        </h2>
        <p className="mt-3 text-sm text-content-muted">
          {selectedRequestId
            ? 'That request finished and was evicted from the live view.'
            : 'Select a request to read its stage timeline.'}
        </p>
        {selectedRequestId && (
          <button
            type="button"
            onClick={onClear}
            className="mt-3 font-mono text-2xs tracking-widest text-accent uppercase hover:text-accent-hover"
          >
            Clear
          </button>
        )}
      </Frame>
    )
  }

  return (
    <Frame className={className}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-mono text-2xs tracking-widest text-content-faint uppercase">
            Inspector
          </h2>
          <p className="mt-1 truncate font-mono text-sm text-content-primary">
            {trace.requestId}
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 font-mono text-2xs tracking-widest text-content-muted uppercase hover:text-content-primary"
        >
          Close
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge
          status={
            trace.isComplete ? 'success' : trace.isInterrupted ? 'error' : 'neutral'
          }
          dot
        >
          {trace.isComplete
            ? 'complete'
            : trace.isInterrupted
              ? 'interrupted'
              : trace.currentStage}
        </Badge>
        {trace.cacheHit && <Badge status="cached">cache hit</Badge>}
        {trace.didFallback && <Badge status="half_open">fallback</Badge>}
        {trace.provider && <Badge status="neutral">{trace.provider}</Badge>}
      </div>

      <p className="mt-3 text-2xs leading-relaxed text-content-muted">
        <span className="font-mono tracking-wide text-content-faint uppercase">
          path:{' '}
        </span>
        {pathSummary(trace)}
      </p>

      {trace.isInterrupted && (
        <p className="mt-2 text-2xs text-content-muted">
          The stream reconnected while this request was in flight. Its remaining stages
          were not replayed.
        </p>
      )}

      {trace.skipped.length > 0 && (
        <p className="mt-2 font-mono text-2xs text-content-muted">
          skipped: {trace.skipped.join(', ')}
        </p>
      )}

      <ol className="mt-4 space-y-3">
        {trace.events.map((entry, index) => (
          <StageRow
            key={`${entry.stage}-${index}`}
            entry={entry}
            offsetMs={entry.receivedAt - trace.startedAt}
            isLast={index === trace.events.length - 1}
          />
        ))}
      </ol>
    </Frame>
  )
}

function StageRow({
  entry,
  offsetMs,
  isLast,
}: {
  entry: TraceTimelineEntry
  offsetMs: number
  isLast: boolean
}) {
  const detailEntries = Object.entries(entry.detail)

  return (
    <li className="relative pl-5">
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-1.5 left-0 h-2 w-2 rounded-full',
          STAGE_TONE[entry.stage],
        )}
      />
      {!isLast && (
        <span
          aria-hidden="true"
          className="absolute top-4 bottom-[-0.75rem] left-[3px] w-px bg-surface-line"
        />
      )}

      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-xs text-content-primary">{entry.stage}</span>
        <span className="font-mono text-2xs text-content-faint">
          {formatOffset(offsetMs)}
        </span>
      </div>

      <p className="font-mono text-2xs text-content-faint">
        {formatClock(entry.timestamp)}
      </p>

      {detailEntries.length > 0 && (
        <dl className="mt-1.5 space-y-0.5">
          {detailEntries.map(([key, value]) => (
            <div key={key} className="flex gap-2 font-mono text-2xs">
              <dt className="shrink-0 text-content-faint">{key}</dt>
              <dd className="min-w-0 truncate text-content-secondary">
                {formatValue(value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  )
}
