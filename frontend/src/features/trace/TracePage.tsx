import { useMemo } from 'react'

import type { SseStatus } from '@/api/sse'
import { PageHeader } from '@/app/layout/PageHeader'
import { Badge, Card } from '@/components/ui'
import type { BadgeStatus } from '@/components/ui'
import { useProviderStates } from '@/features/admin/hooks/useAdminData'
import { CircuitCanvas } from '@/features/trace/CircuitCanvas'
import { StageTimeline } from '@/features/trace/StageTimeline'
import { TraceRequestList } from '@/features/trace/TraceRequestList'
import { useTraceStream } from '@/features/trace/hooks/useTraceStream'
import { toProviderCircuitStates } from '@/features/trace/lib/providerCircuitStates'
import {
  useActiveTraces,
  useSelectedTrace,
  useTraceStore,
  useTraceSweeper,
} from '@/features/trace/store/traceStore'
import { MEDIA, useMediaQuery } from '@/hooks/useMediaQuery'

/**
 * Live pipeline view: the circuit canvas, plus an inspector for one request.
 *
 * The canvas reads from `traceStore`, which is fed by `useTraceStream` and
 * nothing else. Provider node colour comes from the admin providers query —
 * the same query the admin dashboard uses, not a second fetch of the same
 * endpoint.
 *
 * SMALL-VIEWPORT BEHAVIOUR — the canvas is not rendered below `lg`.
 *
 * It is a 960×430 diagram carrying eleven labelled nodes. Fitted to a 375px
 * column it scales to roughly a third, which puts its 11px labels near 4px:
 * the picture survives, the information does not. The two alternatives were
 * both worse. Pan/zoom asks the user to chase a moving packet with two fingers
 * on a view whose entire job is at-a-glance monitoring, and a squashed
 * portrait relayout would be a second graph model to keep in sync with the
 * first. So below `lg` the panel that is already the canvas's semantic
 * equivalent — the request list plus the stage timeline — simply becomes the
 * whole page. Nothing is hidden, and the same two components serve both
 * layouts, so there is no second code path to drift.
 */
export function TracePage() {
  const traces = useActiveTraces()
  const selectedTrace = useSelectedTrace()
  const selectedRequestId = useTraceStore((state) => state.selectedRequestId)
  const selectRequest = useTraceStore((state) => state.selectRequest)

  // Not `hidden lg:block`: the canvas animates continuously, and a hidden SVG
  // still schedules every frame. Below `lg` it must not exist.
  const showCanvas = useMediaQuery(MEDIA.lgUp)

  // Connect on mount, disconnect on unmount — the stream is only worth paying
  // for while this page is on screen.
  const stream = useTraceStream()

  // Drives eviction of completed, interrupted and stale traces.
  useTraceSweeper()

  const providersQuery = useProviderStates()
  const providerStates = useMemo(
    () => toProviderCircuitStates(providersQuery.data),
    [providersQuery.data],
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 sm:p-6">
      <PageHeader
        title="Trace"
        description="Every request in flight, one packet each. Select a request to inspect its stages."
      >
        {providersQuery.isError && (
          <Badge
            status="neutral"
            title={providersQuery.error.message}
            aria-label="Circuit state unavailable. Provider nodes are shown idle."
          >
            circuits unavailable
          </Badge>
        )}
        <StreamStatus
          status={stream.status}
          retryCount={stream.retryCount}
          gapCount={stream.gapCount}
        />
      </PageHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        {showCanvas && (
          <Card
            padding="none"
            className="relative min-h-[320px] min-w-0 flex-1 overflow-hidden bg-surface-sunken"
          >
            <CircuitCanvas
              traces={traces}
              providerStates={providerStates}
              selectedRequestId={selectedRequestId}
              onSelect={selectRequest}
            />
          </Card>
        )}

        <aside className="flex min-h-0 flex-1 flex-col gap-4 lg:w-80 lg:flex-none">
          <TraceRequestList
            traces={traces}
            selectedRequestId={selectedRequestId}
            onSelect={selectRequest}
            className="max-h-56 shrink-0 lg:max-h-64"
          />
          <StageTimeline
            trace={selectedTrace}
            selectedRequestId={selectedRequestId}
            onClear={() => selectRequest(null)}
            className="min-h-0 flex-1"
          />
        </aside>
      </div>
    </div>
  )
}

/* ── Connection status ───────────────────────────────────────────── */

const STREAM_BADGE: Record<SseStatus, { status: BadgeStatus; label: string }> = {
  connecting: { status: 'neutral', label: 'connecting' },
  open: { status: 'success', label: 'live' },
  // `api/sse.ts` is already backing off toward another attempt, so "error" is
  // more honestly reported to the user as a reconnect in progress.
  error: { status: 'error', label: 'reconnecting' },
  closed: { status: 'neutral', label: 'offline' },
}

const STREAM_ANNOUNCEMENT: Record<SseStatus, string> = {
  connecting: 'Connecting to the trace stream.',
  open: 'Trace stream is live.',
  error: 'Trace stream dropped. Reconnecting.',
  closed: 'Trace stream is offline.',
}

function StreamStatus({
  status,
  retryCount,
  gapCount,
}: {
  status: SseStatus
  retryCount: number
  gapCount: number
}) {
  const { status: badgeStatus, label } = STREAM_BADGE[status]
  const detail = [
    `stream: ${status}`,
    retryCount > 0 ? `retry ${retryCount}` : null,
    gapCount > 0 ? `${gapCount} reconnect${gapCount === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <>
      <Badge status={badgeStatus} dot title={detail} aria-hidden="true">
        {label}
        {retryCount > 0 && status === 'error' ? ` ${retryCount}` : ''}
      </Badge>

      {/* The badge is the sighted signal; this is the same fact announced on
          change only. Retry counts are deliberately left out — they tick every
          few seconds while the backend is down, and announcing each one would
          bury the one thing that matters, which is that the stream is gone. */}
      <span role="status" aria-live="polite" className="sr-only">
        {STREAM_ANNOUNCEMENT[status]}
      </span>
    </>
  )
}
