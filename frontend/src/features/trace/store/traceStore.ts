import { useEffect, useMemo } from 'react'
import { create } from 'zustand'

import type { TraceEvent } from '@/api/schemas'
import {
  readCacheHit,
  readProvider,
  readSkippedProvider,
} from '@/features/trace/lib/traceDetail'
import { TRACE_STAGES, type Provider, type TraceStage } from '@/types/enums'

/**
 * Live trace state: many concurrent requests, each an ordered timeline.
 *
 * Input-agnostic by design — `addEvent` takes a validated `TraceEvent` and
 * nothing else. In production that comes from `TraceStreamClient` via
 * `useTraceStream`; in tests it is called directly with a fixed clock. Neither
 * source is visible from here, and neither needs a different store.
 *
 * Eviction is a real mechanism, not a hope: completed traces are dropped a few
 * seconds after their `complete` event, traces that go silent are dropped on
 * age, and a hard cap bounds the pathological case where neither fires.
 */

/* ── Tunables ────────────────────────────────────────────────────── */

/** Grace period after `complete`, long enough for the fade-out to finish. */
export const COMPLETED_TTL_MS = 3_000

/**
 * A request that stops emitting is presumed lost — the stream is best-effort
 * and does not replay, so a half-drawn packet would otherwise sit forever.
 */
export const STALE_TTL_MS = 60_000

/** Hard ceiling. Oldest traces go first if the other two rules can't keep up. */
export const MAX_TRACES = 60

/** How often `useTraceSweeper` runs the age sweep. */
export const SWEEP_INTERVAL_MS = 1_000

/**
 * After a stream gap, how long an in-flight request gets to prove it survived
 * before it is declared interrupted.
 *
 * A real request rarely goes 4s between stages, so a trace that is silent for
 * that long across a reconnect almost certainly finished while we were not
 * listening — and the stream does not replay, so we will never hear about it.
 */
export const INTERRUPT_GRACE_MS = 4_000

/** How long an interrupted packet stays on the canvas before being dropped. */
export const INTERRUPTED_TTL_MS = 2_000

/* ── Shape ───────────────────────────────────────────────────────── */

const STAGE_ORDER = new Map<TraceStage, number>(
  TRACE_STAGES.map((stage, index) => [stage, index]),
)

function stageRank(stage: TraceStage): number {
  return STAGE_ORDER.get(stage) ?? 0
}

export interface TraceTimelineEntry {
  stage: TraceStage
  /** Backend clock, ISO-8601. May skew from ours — never used for eviction. */
  timestamp: string
  detail: Record<string, unknown>
  /** Our clock, at ingest. This is what ages a trace out. */
  receivedAt: number
}

export interface RequestTrace {
  requestId: string
  /** Ordered by arrival, which the contract says is stage order. */
  events: TraceTimelineEntry[]
  currentStage: TraceStage
  /** Provider currently targeted. `null` until an event names one. */
  provider: Provider | null
  /** Provider abandoned by the most recent fallback. */
  skippedProvider: Provider | null
  /** Every provider abandoned, oldest first — a request may fall back twice. */
  skipped: Provider[]
  didFallback: boolean
  /** True only when a `cache_check` event positively reported a hit. */
  cacheHit: boolean
  isComplete: boolean
  /**
   * Set when a stream gap passed without this request finishing. The packet
   * is drawn as interrupted and then dropped — it is never going to complete,
   * because the events that would have completed it are gone.
   */
  isInterrupted: boolean
  interruptedAt: number | null
  /** When a stream gap put this request at risk. Cleared by any new event. */
  atRiskSince: number | null
  startedAt: number
  updatedAt: number
  completedAt: number | null
  /**
   * Bumped on every ingested event. Consumers key animations off this rather
   * than off array identity, which changes for unrelated reasons.
   */
  revision: number
}

interface TraceState {
  traces: Record<string, RequestTrace>
  /** Insertion order of live request ids. Kept stable for render order. */
  order: string[]
  /** Request shown in the detail timeline, if any. */
  selectedRequestId: string | null

  /**
   * Ingest one event. `receivedAt` exists so tests (and any future replay at
   * a simulated clock) can be deterministic; production callers omit it.
   */
  addEvent: (event: TraceEvent, receivedAt?: number) => void
  /**
   * Called when the stream reconnects after a drop. Every request still in
   * flight is put at risk; the sweep decides their fate once the grace period
   * is up.
   */
  markStreamGap: (now?: number) => void
  selectRequest: (requestId: string | null) => void
  /** Age sweep. Exposed so it can be driven by a test as well as a timer. */
  sweep: (now?: number) => void
  clear: () => void
}

/* ── Reducers (pure, exported for tests) ─────────────────────────── */

function createTrace(requestId: string, entry: TraceTimelineEntry): RequestTrace {
  return {
    requestId,
    events: [],
    currentStage: entry.stage,
    provider: null,
    skippedProvider: null,
    skipped: [],
    didFallback: false,
    cacheHit: false,
    isComplete: false,
    isInterrupted: false,
    interruptedAt: null,
    atRiskSince: null,
    startedAt: entry.receivedAt,
    updatedAt: entry.receivedAt,
    completedAt: null,
    revision: 0,
  }
}

/**
 * Fold one event into a trace.
 *
 * Stage never moves backwards: a duplicate or late frame updates the timeline
 * and the derived fields but cannot drag the packet back up the pipeline.
 */
export function applyEvent(trace: RequestTrace, entry: TraceTimelineEntry): RequestTrace {
  const next: RequestTrace = {
    ...trace,
    events: [...trace.events, entry],
    updatedAt: entry.receivedAt,
    revision: trace.revision + 1,
    // Any event is proof of life: a request that kept talking across a stream
    // gap was never interrupted, whatever the gap made us assume.
    atRiskSince: null,
    isInterrupted: false,
    interruptedAt: null,
    currentStage:
      stageRank(entry.stage) >= stageRank(trace.currentStage)
        ? entry.stage
        : trace.currentStage,
  }

  const named = readProvider(entry.detail)
  if (named) next.provider = named

  switch (entry.stage) {
    case 'cache_check': {
      // `null` (undetermined) is not a hit — see lib/traceDetail.ts.
      if (readCacheHit(entry.detail) === true) {
        next.cacheHit = true
        /*
         * A hit ends the request.
         *
         * Observed live: on a cache hit the backend emits `classify` then
         * `cache` and stops — there is no `complete` frame, even though the
         * chat response comes back with `status: "cached"`. Waiting for one
         * would strand the packet until the 60s stale sweep, so the hit is
         * treated as the terminal event it actually is. A later `complete`
         * frame, if the backend adds one, simply re-stamps this.
         */
        next.isComplete = true
        next.completedAt = entry.receivedAt
      }
      break
    }
    case 'fallback': {
      next.didFallback = true
      // The event may name the abandoned provider; if not, it is whichever
      // provider we were pointed at before this event landed.
      const skipped = readSkippedProvider(entry.detail) ?? trace.provider
      if (skipped) {
        next.skippedProvider = skipped
        next.skipped = [...trace.skipped, skipped]
      }
      break
    }
    case 'complete': {
      next.isComplete = true
      next.completedAt = entry.receivedAt
      break
    }
    default:
      break
  }

  return next
}

/** True when a trace has outlived its usefulness at `now`. */
export function isEvictable(trace: RequestTrace, now: number): boolean {
  if (trace.isComplete && trace.completedAt !== null) {
    return now - trace.completedAt >= COMPLETED_TTL_MS
  }
  if (trace.isInterrupted && trace.interruptedAt !== null) {
    return now - trace.interruptedAt >= INTERRUPTED_TTL_MS
  }
  return now - trace.updatedAt >= STALE_TTL_MS
}

/**
 * Promote an at-risk trace to interrupted once its grace period lapses.
 *
 * Returns the same object when nothing changes, so the sweep can tell whether
 * it needs to publish a new state at all.
 */
function resolveAtRisk(trace: RequestTrace, now: number): RequestTrace {
  if (trace.atRiskSince === null || trace.isComplete || trace.isInterrupted) return trace
  if (now - trace.atRiskSince < INTERRUPT_GRACE_MS) return trace

  return { ...trace, isInterrupted: true, interruptedAt: now, atRiskSince: null }
}

function pruneToCapacity(
  traces: Record<string, RequestTrace>,
  order: string[],
  keepId: string | null,
): { traces: Record<string, RequestTrace>; order: string[] } {
  if (order.length <= MAX_TRACES) return { traces, order }

  const overflow = order.length - MAX_TRACES
  const dropped = new Set<string>()

  for (const id of order) {
    if (dropped.size >= overflow) break
    if (id === keepId) continue // never drop the trace being inspected
    dropped.add(id)
  }

  if (dropped.size === 0) return { traces, order }

  const nextTraces: Record<string, RequestTrace> = {}
  for (const [id, trace] of Object.entries(traces)) {
    if (!dropped.has(id)) nextTraces[id] = trace
  }

  return { traces: nextTraces, order: order.filter((id) => !dropped.has(id)) }
}

/* ── Store ───────────────────────────────────────────────────────── */

export const useTraceStore = create<TraceState>((set) => ({
  traces: {},
  order: [],
  selectedRequestId: null,

  addEvent: (event, receivedAt) =>
    set((state) => {
      const entry: TraceTimelineEntry = {
        stage: event.stage,
        timestamp: event.timestamp,
        detail: event.detail,
        receivedAt: receivedAt ?? Date.now(),
      }

      const existing = state.traces[event.request_id]
      const base = existing ?? createTrace(event.request_id, entry)
      const updated = applyEvent(base, entry)

      const traces = { ...state.traces, [event.request_id]: updated }
      const order = existing ? state.order : [...state.order, event.request_id]

      return pruneToCapacity(traces, order, state.selectedRequestId)
    }),

  /**
   * RECONNECT POLICY.
   *
   * The trace stream is best-effort and live-only: it does not replay, so
   * events emitted during a disconnect are gone for good. A request that was
   * mid-pipeline when the connection dropped will therefore never receive its
   * `complete` event, and its packet would otherwise sit on the canvas
   * forever, animating a request that finished minutes ago.
   *
   * So on reconnect every in-flight request is put at risk rather than killed
   * outright — a long-running call may well still be running, and its next
   * stage event clears the flag (see `applyEvent`). Only requests that stay
   * silent through `INTERRUPT_GRACE_MS` are marked interrupted, shown as such
   * briefly, and then dropped. Completed requests are untouched; they already
   * have everything they are going to get.
   *
   * The alternative — clearing the store on reconnect — was rejected: it would
   * also wipe genuinely live requests that survived the gap.
   */
  markStreamGap: (now) =>
    set((state) => {
      const at = now ?? Date.now()
      let changed = false
      const traces: Record<string, RequestTrace> = { ...state.traces }

      for (const [id, trace] of Object.entries(state.traces)) {
        if (trace.isComplete || trace.isInterrupted) continue
        if (trace.atRiskSince !== null) continue
        traces[id] = { ...trace, atRiskSince: at }
        changed = true
      }

      return changed ? { traces } : state
    }),

  selectRequest: (requestId) => set({ selectedRequestId: requestId }),

  sweep: (now) =>
    set((state) => {
      const at = now ?? Date.now()
      let changed = false

      const traces: Record<string, RequestTrace> = {}
      const order: string[] = []

      for (const id of state.order) {
        const existing = state.traces[id]
        if (!existing) {
          changed = true
          continue
        }

        const trace = resolveAtRisk(existing, at)
        if (trace !== existing) changed = true

        // The inspected trace is pinned: evicting it out from under the open
        // timeline panel would blank the panel mid-read. It becomes eligible
        // again the moment the selection moves.
        const isPinned = id === state.selectedRequestId
        if (!isPinned && isEvictable(trace, at)) {
          changed = true
          continue
        }

        traces[id] = trace
        order.push(id)
      }

      return changed ? { traces, order } : state
    }),

  clear: () => set({ traces: {}, order: [], selectedRequestId: null }),
}))

/* ── Selectors ───────────────────────────────────────────────────── */

/**
 * Every live trace, in arrival order.
 *
 * Plain function over a state snapshot — safe in tests and outside React. The
 * hook below is what components use; passing this straight to `useTraceStore`
 * would build a new array on every store write and re-render forever.
 */
export function selectActiveTraces(state: TraceState): RequestTrace[] {
  return state.order
    .map((id) => state.traces[id])
    .filter((trace): trace is RequestTrace => trace !== undefined)
}

export function selectTrace(
  state: TraceState,
  requestId: string | null,
): RequestTrace | null {
  if (!requestId) return null
  return state.traces[requestId] ?? null
}

/** Live traces for the canvas. Memoised against the two stable references. */
export function useActiveTraces(): RequestTrace[] {
  const traces = useTraceStore((state) => state.traces)
  const order = useTraceStore((state) => state.order)

  return useMemo(
    () =>
      order
        .map((id) => traces[id])
        .filter((trace): trace is RequestTrace => trace !== undefined),
    [order, traces],
  )
}

/** The trace currently selected for inspection, if it is still live. */
export function useSelectedTrace(): RequestTrace | null {
  const selectedRequestId = useTraceStore((state) => state.selectedRequestId)
  const traces = useTraceStore((state) => state.traces)

  return selectedRequestId ? (traces[selectedRequestId] ?? null) : null
}

/**
 * Drives the age sweep while mounted.
 *
 * Not started at module scope on purpose: an interval that survives every test
 * file and every SSR import is a leak, and the store is perfectly usable
 * without it (`sweep` can always be called directly).
 */
export function useTraceSweeper(intervalMs: number = SWEEP_INTERVAL_MS): void {
  useEffect(() => {
    const timer = setInterval(() => {
      useTraceStore.getState().sweep()
    }, intervalMs)

    return () => clearInterval(timer)
  }, [intervalMs])
}
