import { Badge, Card } from '@/components/ui'
import type { BadgeStatus } from '@/components/ui'
import type { RequestTrace } from '@/features/trace/store/traceStore'
import { cn } from '@/lib/cn'

/**
 * Every in-flight request as a plain, selectable list.
 *
 * This is not a mobile-only convenience — it is the app's only *accessible*
 * way to reach a packet. The canvas is an `aria-hidden` picture: an SVG full
 * of tabbable `role="button"` groups reads as a wall of unlabelled stops to a
 * screen reader, and hit-testing a moving circle is not a keyboard gesture.
 * So the canvas keeps the pointer story, and this list carries the semantics
 * for everyone else, on every viewport.
 *
 * Paired with `StageTimeline`, it is the full non-visual equivalent: this
 * answers "which requests exist and where is each one", the timeline answers
 * "what happened to this one, in order".
 */

export interface TraceRequestListProps {
  traces: RequestTrace[]
  selectedRequestId: string | null
  onSelect: (requestId: string | null) => void
  className?: string
}

function statusOf(trace: RequestTrace): { status: BadgeStatus; label: string } {
  if (trace.isInterrupted) return { status: 'error', label: 'interrupted' }
  if (trace.cacheHit) return { status: 'cached', label: 'cache hit' }
  if (trace.isComplete) return { status: 'success', label: 'complete' }
  if (trace.didFallback) return { status: 'half_open', label: trace.currentStage }
  return { status: 'neutral', label: trace.currentStage }
}

/** Request ids are long and share a prefix; the tail is the part that differs. */
function shortId(requestId: string): string {
  return requestId.length > 16 ? `…${requestId.slice(-13)}` : requestId
}

export function TraceRequestList({
  traces,
  selectedRequestId,
  onSelect,
  className,
}: TraceRequestListProps) {
  return (
    <Card padding="md" className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-mono text-2xs tracking-widest text-content-faint uppercase">
          In flight
        </h2>
        <span className="font-mono text-2xs text-content-faint">{traces.length}</span>
      </div>

      {/* Announces arrivals and departures without the user watching anything.
          Bounded to a count, not a per-event narration — a busy pipeline would
          otherwise talk continuously. */}
      <span role="status" aria-live="polite" className="sr-only">
        {traces.length === 1
          ? '1 request in flight.'
          : `${traces.length} requests in flight.`}
      </span>

      {traces.length === 0 ? (
        <p className="mt-3 text-sm text-content-muted">
          Nothing in flight. Send a prompt from Chat to watch one arrive.
        </p>
      ) : (
        <ul className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
          {traces.map((trace) => {
            const { status, label } = statusOf(trace)
            const isSelected = trace.requestId === selectedRequestId

            return (
              <li key={trace.requestId}>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onSelect(isSelected ? null : trace.requestId)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left',
                    'transition-colors duration-100 ease-out',
                    isSelected
                      ? 'bg-accent-soft text-content-primary'
                      : 'text-content-secondary hover:bg-surface-overlay',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">
                    {shortId(trace.requestId)}
                  </span>
                  {trace.provider && (
                    <span className="shrink-0 font-mono text-2xs text-content-faint">
                      {trace.provider}
                    </span>
                  )}
                  <Badge status={status} className="shrink-0">
                    {label}
                  </Badge>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
