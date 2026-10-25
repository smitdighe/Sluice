import { useEffect, useState } from 'react'

import { createTraceStream, type SseStatus, type TraceStreamClient } from '@/api/sse'
import { normalizeTraceFrame } from '@/features/trace/lib/normalizeTraceFrame'
import { useTraceStore } from '@/features/trace/store/traceStore'

/**
 * The one place trace events enter the store.
 *
 * Connection concerns — retries, backoff, jitter, frame validation — all
 * belong to `api/sse.ts` and are deliberately not repeated here. This hook is
 * the seam between that client and the store: it owns the lifecycle (connect
 * on mount, disconnect on unmount), surfaces the status for the UI, and hands
 * every validated event to `addEvent`.
 *
 * Mount it on the trace page only. The stream is live-only, so holding it open
 * while the user reads /admin buys nothing and costs a connection.
 */

export interface TraceStreamState {
  status: SseStatus
  /** Consecutive failed attempts since the last successful open. */
  retryCount: number
  /** Number of reconnects in this session — each one is a possible event gap. */
  gapCount: number
}

export interface UseTraceStreamOptions {
  /** Set false to keep the hook mounted without opening a connection. */
  enabled?: boolean
}

export function useTraceStream({
  enabled = true,
}: UseTraceStreamOptions = {}): TraceStreamState {
  const [status, setStatus] = useState<SseStatus>('closed')
  const [retryCount, setRetryCount] = useState(0)
  const [gapCount, setGapCount] = useState(0)

  useEffect(() => {
    if (!enabled) return

    // Read actions off the store handle rather than subscribing to them: this
    // effect must run once per mount, not once per store write.
    const { addEvent, markStreamGap } = useTraceStore.getState()

    let client: TraceStreamClient | null = null
    let droppedSinceOpen = false

    client = createTraceStream({
      onEvent: addEvent,

      // The live stream does not emit the documented envelope. See
      // `lib/normalizeTraceFrame.ts` — this shim is the only thing standing
      // between the wire shape and `TraceEventSchema`.
      normalize: (raw) => normalizeTraceFrame(raw),

      onStatusChange: (next) => {
        setStatus(next)
        setRetryCount(client?.retryCount ?? 0)

        if (next === 'error') {
          droppedSinceOpen = true
          return
        }

        // Reopened after a drop: anything that was in flight may have finished
        // unheard, since this stream has no replay. See `markStreamGap`.
        if (next === 'open' && droppedSinceOpen) {
          droppedSinceOpen = false
          setGapCount((count) => count + 1)
          markStreamGap()
        }
      },

      onError: (error) => {
        // Transport drops arrive here on every retry while the backend is
        // down. They are already reflected in `status`, so logging them would
        // be pure console spam on a loop. A malformed frame is different —
        // that is a contract problem worth seeing once per bad frame.
        const isTransportDrop = typeof Event !== 'undefined' && error instanceof Event
        if (isTransportDrop) return
        console.warn('[trace] dropped a malformed stream frame', error)
      },
    })

    client.connect()

    return () => {
      client?.disconnect()
      client = null
    }
  }, [enabled])

  // Reported rather than stored: a disabled hook is closed by definition, and
  // writing that into state from the effect would just cascade a render.
  return enabled
    ? { status, retryCount, gapCount }
    : { status: 'closed', retryCount: 0, gapCount }
}
