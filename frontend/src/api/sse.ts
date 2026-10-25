import { API_BASE_URL, SSE_RECONNECT_BASE_MS } from '@/api/client'
import { TraceEventSchema, type TraceEvent } from '@/api/schemas'

/**
 * Raw wrapper around `GET /v1/trace/stream`.
 *
 * IMPORTANT — this stream is best-effort and live only. It does not replay
 * history: events emitted before `connect()` (or during a reconnect gap) are
 * gone. Any historical or "what happened earlier" view must be built from
 * polling `/v1/admin/*`, never from this stream.
 *
 * Connection concerns only. Grouping events by `request_id`, ordering stages,
 * and holding them in a store belong to the trace feature in a later phase —
 * deliberately not here.
 */

export type SseStatus = 'connecting' | 'open' | 'closed' | 'error'

export const TRACE_STREAM_PATH = '/v1/trace/stream'

export interface TraceStreamOptions {
  /** Called once per validated event. */
  onEvent: (event: TraceEvent) => void
  /** Called on every status transition. */
  onStatusChange?: (status: SseStatus) => void
  /**
   * Transport failures and malformed frames. A malformed frame is reported
   * here and skipped — one bad event never tears down the stream.
   */
  onError?: (error: unknown) => void
  /**
   * Reshape a decoded frame before it is validated.
   *
   * Exists because the wire format and `TraceEventSchema` are not the same
   * shape today (see `features/trace/lib/normalizeTraceFrame.ts`). Defaults to
   * identity, so a backend that matches the contract needs no adapter and this
   * module keeps knowing nothing about the discrepancy.
   */
  normalize?: (raw: unknown) => unknown
  /** Override the full URL. Defaults to `${API_BASE_URL}${TRACE_STREAM_PATH}`. */
  url?: string
  /** First retry delay; doubles per attempt. Defaults to VITE_SSE_RECONNECT_MS. */
  baseReconnectMs?: number
  /** Ceiling for the backoff. */
  maxReconnectMs?: number
  /** Give up after this many consecutive failures. `Infinity` by default. */
  maxRetries?: number
}

const DEFAULT_MAX_RECONNECT_MS = 30_000

export class TraceStreamClient {
  private source: EventSource | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private attempt = 0
  private closedByCaller = false
  private currentStatus: SseStatus = 'closed'

  private readonly options: TraceStreamOptions
  private readonly url: string
  private readonly baseReconnectMs: number
  private readonly maxReconnectMs: number
  private readonly maxRetries: number

  constructor(options: TraceStreamOptions) {
    this.options = options
    this.url = options.url ?? `${API_BASE_URL}${TRACE_STREAM_PATH}`
    this.baseReconnectMs =
      options.baseReconnectMs ??
      (Number.isFinite(SSE_RECONNECT_BASE_MS) && SSE_RECONNECT_BASE_MS > 0
        ? SSE_RECONNECT_BASE_MS
        : 2000)
    this.maxReconnectMs = options.maxReconnectMs ?? DEFAULT_MAX_RECONNECT_MS
    this.maxRetries = options.maxRetries ?? Number.POSITIVE_INFINITY
  }

  get status(): SseStatus {
    return this.currentStatus
  }

  /** Consecutive failed attempts since the last successful open. */
  get retryCount(): number {
    return this.attempt
  }

  connect(): void {
    if (typeof EventSource === 'undefined') {
      this.setStatus('error')
      this.options.onError?.(new Error('EventSource is unavailable in this environment.'))
      return
    }

    this.closedByCaller = false
    this.clearRetryTimer()
    this.closeSource()
    this.setStatus('connecting')

    let source: EventSource
    try {
      source = new EventSource(this.url)
    } catch (error) {
      this.options.onError?.(error)
      this.scheduleReconnect()
      return
    }

    source.onopen = () => {
      this.attempt = 0
      this.setStatus('open')
    }

    source.onmessage = (message: MessageEvent<string>) => {
      this.handleMessage(message.data)
    }

    source.onerror = (event) => {
      // EventSource does not surface a reason; treat every error as a drop.
      this.options.onError?.(event)
      this.closeSource()
      if (this.closedByCaller) return
      this.setStatus('error')
      this.scheduleReconnect()
    }

    this.source = source
  }

  /** Stop the stream and cancel any pending retry. Safe to call repeatedly. */
  disconnect(): void {
    this.closedByCaller = true
    this.clearRetryTimer()
    this.closeSource()
    this.attempt = 0
    this.setStatus('closed')
  }

  private handleMessage(raw: string): void {
    let payload: unknown
    try {
      payload = JSON.parse(raw)
    } catch (error) {
      this.options.onError?.(error)
      return
    }

    if (this.options.normalize) {
      try {
        payload = this.options.normalize(payload)
      } catch (error) {
        this.options.onError?.(error)
        return
      }
    }

    const result = TraceEventSchema.safeParse(payload)
    if (!result.success) {
      this.options.onError?.(result.error)
      return
    }

    this.options.onEvent(result.data)
  }

  private scheduleReconnect(): void {
    if (this.closedByCaller) return

    if (this.attempt >= this.maxRetries) {
      this.setStatus('closed')
      return
    }

    const delay = this.backoffDelay(this.attempt)
    this.attempt += 1

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (!this.closedByCaller) this.connect()
    }, delay)
  }

  /** Exponential backoff with jitter, so reconnects don't sync up. */
  private backoffDelay(attempt: number): number {
    const exponential = this.baseReconnectMs * 2 ** attempt
    const capped = Math.min(exponential, this.maxReconnectMs)
    return Math.round(capped * (0.75 + Math.random() * 0.25))
  }

  private clearRetryTimer(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  private closeSource(): void {
    if (this.source) {
      this.source.onopen = null
      this.source.onmessage = null
      this.source.onerror = null
      this.source.close()
      this.source = null
    }
  }

  private setStatus(status: SseStatus): void {
    if (this.currentStatus === status) return
    this.currentStatus = status
    this.options.onStatusChange?.(status)
  }
}

/**
 * Convenience factory.
 *
 * Note: `EventSource` cannot send custom headers, so `VITE_API_KEY` is not
 * attached here. If the backend starts requiring auth on this route it will
 * need a cookie or a short-lived token — not the raw key in the query string,
 * which would end up in access logs.
 */
export function createTraceStream(options: TraceStreamOptions): TraceStreamClient {
  return new TraceStreamClient(options)
}
