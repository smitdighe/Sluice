import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  type AnimationPlaybackControls,
} from 'framer-motion'
import { memo, useCallback, useEffect, useRef, useState } from 'react'

import {
  edgeBetween,
  findEdge,
  nodePosition,
  providerNodeId,
  type GraphEdge,
  type NodeId,
} from '@/features/trace/lib/graphModel'
import { packetNodeId } from '@/features/trace/lib/packetPosition'
import type { RequestTrace } from '@/features/trace/store/traceStore'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { EASE_IN, EASE_STANDARD } from '@/lib/animationVariants'

/**
 * One in-flight request, drawn as a packet walking the graph.
 *
 * Each packet owns its own animation state — position, queue, timers — so N
 * concurrent requests are N independent components with nothing shared but the
 * static graph. Nothing here reads global "current stage" state, because there
 * is no such thing: the store holds one timeline per `request_id`.
 *
 * Movement is driven by a single `progress` motion value per packet, mapped
 * through the edge's own Bézier geometry. That keeps the packet exactly on the
 * line the canvas drew, rather than approximating it with a straight tween.
 *
 * Memoised, because the store hands the canvas a fresh `traces` array on every
 * ingested event: without it, one request emitting a stage re-renders all N
 * packets. `trace` identity only changes for the request that actually moved,
 * and `onSelect` is a stable zustand action, so the guard holds.
 *
 * The packet carries no ARIA. It lives inside an `aria-hidden` canvas — see
 * the accessibility note in `CircuitCanvas.tsx`.
 */

export interface RequestPacketProps {
  trace: RequestTrace
  isSelected: boolean
  onSelect: (requestId: string) => void
}

/* ── Motion tuning ───────────────────────────────────────────────── */

/** User units per second. Long edges take longer — speed reads as constant. */
const TRAVEL_UNITS_PER_S = 620
const MIN_TRAVEL_S = 0.32
const MAX_TRAVEL_S = 1.0
const FADE_OUT_S = 0.55

function travelSeconds(length: number): number {
  return Math.min(MAX_TRAVEL_S, Math.max(MIN_TRAVEL_S, length / TRAVEL_UNITS_PER_S))
}

/* ── Component ───────────────────────────────────────────────────── */

export const RequestPacket = memo(function RequestPacket({
  trace,
  isSelected,
  onSelect,
}: RequestPacketProps) {
  const prefersReducedMotion = useReducedMotion()
  const target = packetNodeId(trace)

  // Mount position: wherever the trace already is, frozen at first render. A
  // packet that appears mid-flow starts at its real node instead of replaying
  // the pipeline from `classify`.
  const [mountNode] = useState<NodeId>(target)
  const mountPoint = nodePosition(mountNode)

  const positionRef = useRef<NodeId>(mountNode)
  const x = useMotionValue(mountPoint.x)
  const y = useMotionValue(mountPoint.y)
  const progress = useMotionValue(0)

  const legRef = useRef<GraphEdge | null>(null)
  const [leg, setLeg] = useState<GraphEdge | null>(null)
  const [atNode, setAtNode] = useState<NodeId>(mountNode)

  const queueRef = useRef<NodeId[]>([])
  const runningRef = useRef(false)
  const mountedRef = useRef(true)
  const animationRef = useRef<AnimationPlaybackControls | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      animationRef.current?.stop()
    }
  }, [])

  // Progress → a point on the current edge. Imperative rather than
  // `useTransform` so the mapping can never lag a leg change by a render.
  useMotionValueEvent(progress, 'change', (value) => {
    const edge = legRef.current
    if (!edge) return
    const inv = 1 - value
    x.set(
      inv * inv * edge.start.x +
        2 * inv * value * edge.control.x +
        value * value * edge.end.x,
    )
    y.set(
      inv * inv * edge.start.y +
        2 * inv * value * edge.control.y +
        value * value * edge.end.y,
    )
  })

  /**
   * Walks queued destinations one edge at a time.
   *
   * Queued rather than interrupted: events arrive faster than a packet
   * travels, and cutting a leg short mid-edge would teleport it. Walking each
   * leg in turn keeps the path readable — which matters most for the fallback,
   * where the whole point is *seeing* the reroute.
   */
  const runQueue = useCallback(async () => {
    if (runningRef.current) return
    runningRef.current = true

    while (queueRef.current.length > 0) {
      const next = queueRef.current.shift()
      if (next === undefined) break

      const from = positionRef.current
      if (next === from) continue

      const edge = edgeBetween(from, next)

      // Reduced motion: snap to the destination. Deliberately not "the same
      // journey, faster" — no travel happens at all.
      if (prefersReducedMotion) {
        positionRef.current = next
        legRef.current = null
        x.set(edge.end.x)
        y.set(edge.end.y)
        if (!mountedRef.current) break
        setLeg(null)
        setAtNode(next)
        continue
      }

      legRef.current = edge
      progress.set(0)
      if (mountedRef.current) setLeg(edge)

      const controls = animate(progress, 1, {
        duration: travelSeconds(edge.length),
        ease: EASE_STANDARD,
      })
      animationRef.current = controls

      try {
        await controls.finished
      } catch {
        // Stopped on unmount — abandon the rest of the queue.
        break
      }

      positionRef.current = next
      legRef.current = null
      if (!mountedRef.current) break
      setLeg(null)
      setAtNode(next)
    }

    runningRef.current = false
  }, [prefersReducedMotion, progress, x, y])

  useEffect(() => {
    const queue = queueRef.current
    const last = queue.length > 0 ? queue[queue.length - 1] : positionRef.current
    if (target === last) return

    queue.push(target)
    void runQueue()
  }, [target, runQueue])

  /* ── Derived visuals ───────────────────────────────────────────── */

  const hasArrived = trace.isComplete && atNode === 'complete' && leg === null

  /**
   * The reroute arc.
   *
   * Under normal motion it is the leg being travelled. Under reduced motion
   * there is no leg — the packet snapped — so it is derived from the trace
   * instead and drawn statically for as long as the request sits in
   * `fallback`. The information survives; only the movement is dropped.
   */
  const reroute =
    leg?.kind === 'fallback'
      ? leg
      : prefersReducedMotion &&
          trace.currentStage === 'fallback' &&
          trace.skippedProvider &&
          trace.provider
        ? findEdge(providerNodeId(trace.skippedProvider), providerNodeId(trace.provider))
        : null

  const isRerouting = reroute !== null

  /**
   * A cache hit pings at the cache node instead of continuing down the call
   * path — a completely different gesture from a packet traversal.
   *
   * Tied to the trace rather than to the packet's whereabouts: the live stream
   * reports `route` before `cache`, so a packet is never sitting on the cache
   * node when the hit is announced. The ping runs until the packet fades.
   */
  const showRipple = trace.cacheHit && !hasArrived

  // Interrupted wins over every other tone: the packet is no longer tracking
  // anything real, and saying so matters more than what it was doing.
  const tone = trace.isInterrupted
    ? 'text-status-error'
    : isRerouting
      ? 'text-status-half_open'
      : trace.cacheHit
        ? 'text-status-cached'
        : hasArrived
          ? 'text-status-success'
          : 'text-accent'

  const shortId =
    trace.requestId.length > 14 ? `…${trace.requestId.slice(-11)}` : trace.requestId

  return (
    <g>
      {/* The fallback edge exists only while it is being used. */}
      {reroute && (
        <g className="text-status-half_open" aria-hidden="true">
          <motion.path
            d={reroute.d}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeDasharray="4 5"
            initial={
              prefersReducedMotion
                ? { pathLength: 1, opacity: 0.85 }
                : { pathLength: 0, opacity: 0 }
            }
            animate={{ pathLength: 1, opacity: 0.85 }}
            transition={
              prefersReducedMotion
                ? { duration: 0 }
                : { duration: travelSeconds(reroute.length), ease: EASE_STANDARD }
            }
          />
          {/* Ghost of the provider the router walked away from. */}
          <motion.circle
            cx={reroute.start.x}
            cy={reroute.start.y}
            r={30}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            initial={{ opacity: prefersReducedMotion ? 0.6 : 0.9, scale: 1 }}
            animate={
              prefersReducedMotion
                ? { opacity: 0.6, scale: 1 }
                : { opacity: 0, scale: 1.35 }
            }
            transition={
              prefersReducedMotion ? { duration: 0 } : { duration: 0.7, ease: 'easeOut' }
            }
            style={{ transformOrigin: `${reroute.start.x}px ${reroute.start.y}px` }}
          />
        </g>
      )}

      {showRipple && <CacheRipple isStatic={prefersReducedMotion} />}

      <motion.g
        style={{ x, y }}
        className={tone}
        animate={{ opacity: hasArrived ? 0 : 1 }}
        transition={{
          duration: prefersReducedMotion ? 0 : FADE_OUT_S,
          delay: hasArrived && !prefersReducedMotion ? 0.12 : 0,
          ease: EASE_IN,
        }}
      >
        <circle r={17} fill="currentColor" opacity={0.12} aria-hidden="true" />

        {!prefersReducedMotion && (
          <motion.circle
            r={10}
            fill="none"
            stroke="currentColor"
            strokeWidth={1}
            aria-hidden="true"
            initial={{ opacity: 0.55 }}
            animate={{ r: [10, 18], opacity: [0.55, 0] }}
            transition={{ duration: 1.3, repeat: Infinity, ease: 'easeOut' }}
          />
        )}

        {isSelected && (
          <circle
            r={14}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            opacity={0.8}
            aria-hidden="true"
          />
        )}

        <circle
          r={6.5}
          fill="currentColor"
          style={{ filter: 'drop-shadow(0 0 7px currentColor)' }}
          aria-hidden="true"
        />

        {isSelected && (
          <text
            x={0}
            y={-24}
            textAnchor="middle"
            className="fill-content-secondary font-mono text-[10px] tracking-wide"
          >
            {shortId}
          </text>
        )}

        {/* Generous, invisible hit target — the packet itself is 13px wide. */}
        <circle
          r={18}
          fill="transparent"
          className="cursor-pointer"
          onClick={() => onSelect(trace.requestId)}
        >
          <title>
            {`${trace.requestId} · ${trace.isInterrupted ? 'interrupted' : trace.currentStage}`}
          </title>
        </circle>
      </motion.g>
    </g>
  )
})

/**
 * Expanding rings at the cache node.
 *
 * Reduced motion gets a single static ring: the information ("this was a cache
 * hit") survives, the movement does not.
 */
function CacheRipple({ isStatic }: { isStatic: boolean }) {
  const center = nodePosition('cache_check')

  if (isStatic) {
    return (
      <circle
        cx={center.x}
        cy={center.y}
        r={40}
        fill="none"
        strokeWidth={1.5}
        className="stroke-status-cached"
        opacity={0.7}
        aria-hidden="true"
      />
    )
  }

  return (
    <g className="text-status-cached" aria-hidden="true">
      {[0, 0.35, 0.7].map((delay) => (
        <motion.circle
          key={delay}
          cx={center.x}
          cy={center.y}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          initial={{ r: 26, opacity: 0.65 }}
          animate={{ r: 62, opacity: 0 }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut', delay }}
        />
      ))}
    </g>
  )
}
