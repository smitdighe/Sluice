import { motion } from 'framer-motion'
import { memo, useMemo } from 'react'

import { RequestPacket } from '@/features/trace/RequestPacket'
import {
  CANVAS,
  NODES,
  STATIC_EDGES,
  type GraphEdge,
  type GraphNode,
  type NodeId,
  type ProviderNode,
} from '@/features/trace/lib/graphModel'
import { packetNodeId } from '@/features/trace/lib/packetPosition'
import type { RequestTrace } from '@/features/trace/store/traceStore'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { cn } from '@/lib/cn'
import type { CircuitState, Provider } from '@/types/enums'

/**
 * The persistent circuit: nodes, edges, and every packet currently on it.
 *
 * This is the ambient layer. With zero active requests it still has to look
 * like a deliberate diagram rather than an empty state, so the resting picture
 * carries its own detail — grid, labelled nodes, a slow current along the
 * spine, and the cache shortcut drawn even when nothing is using it.
 *
 * Fallback edges are the one exception: all six exist in the graph model but
 * none are painted here. They appear only under a rerouting packet, which is
 * what makes a fallback read as a swerve instead of as one more line.
 *
 * ACCESSIBILITY — this whole subtree is `aria-hidden`, on purpose.
 *
 * It was previously an `role="img"` SVG containing eleven tabbable
 * `role="button"` groups. That is the worst of both: `role="img"` hides every
 * descendant from assistive tech, so the buttons announced as nothing, while
 * still sitting in the tab order as eleven silent stops. Rather than paper
 * over it with labels, the canvas is now honestly declared decorative and the
 * semantics live in `TraceRequestList` + `StageTimeline`, which are rendered
 * beside it at every viewport. Pointer users keep the canvas; everyone else
 * gets a list that says the same thing in words.
 */

export interface CircuitCanvasProps {
  traces: RequestTrace[]
  /**
   * Circuit state per provider, when known.
   *
   * Trace events do not carry it — it comes from `GET /v1/admin/providers`,
   * polled by `useProviderStates` and passed straight through by `TracePage`.
   * Absent (the query has not resolved, or it failed), every provider node
   * renders in the neutral idle tone rather than asserting a state we do not
   * have.
   */
  providerStates?: Partial<Record<Provider, CircuitState>>
  selectedRequestId: string | null
  onSelect: (requestId: string | null) => void
  className?: string
}

/* Full class strings — Tailwind never sees `text-status-${state}`. */
const CIRCUIT_TONE: Record<CircuitState, string> = {
  closed: 'text-status-closed',
  open: 'text-status-open',
  half_open: 'text-status-half_open',
}
const IDLE_TONE = 'text-status-neutral'

/**
 * Resting tone for a pipeline stage.
 *
 * `surface.line-strong` measured 1.8:1 against the canvas well — a node
 * outline nobody could see. `content.faint` clears the 3:1 that non-text UI
 * owes. See `styles/contrast.test.ts`.
 */
const IDLE_STAGE_TONE = 'text-content-faint'

const EDGE_TONE: Record<GraphEdge['kind'], string> = {
  pipeline: 'text-surface-line-strong',
  dispatch: 'text-surface-line-strong',
  return: 'text-surface-line-strong',
  cache: 'text-status-cached',
  fallback: 'text-status-half_open',
}

const STAGE_SIZE = 52

export function CircuitCanvas({
  traces,
  providerStates,
  selectedRequestId,
  onSelect,
  className,
}: CircuitCanvasProps) {
  const prefersReducedMotion = useReducedMotion()

  /**
   * Which nodes currently hold a packet, and the newest trace at each — the
   * node's own click target. Derived, never stored: a node is "busy" because
   * traces say so, not because something wrote a flag.
   */
  const occupants = useMemo(() => {
    const map = new Map<NodeId, RequestTrace>()
    for (const trace of traces) map.set(packetNodeId(trace), trace)
    return map
  }, [traces])

  return (
    <div className={cn('relative h-full w-full', className)}>
      <svg
        viewBox={CANVAS.viewBox}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <pattern id="trace-grid" width={40} height={40} patternUnits="userSpaceOnUse">
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              className="stroke-surface-line"
              strokeWidth={1}
              opacity={0.4}
            />
          </pattern>

          <radialGradient id="trace-vignette" cx="50%" cy="50%" r="72%">
            <stop offset="0%" stopColor="#0c0e11" stopOpacity={0} />
            <stop offset="100%" stopColor="#070809" stopOpacity={0.85} />
          </radialGradient>
        </defs>

        <rect width={CANVAS.width} height={CANVAS.height} fill="url(#trace-grid)" />
        <rect width={CANVAS.width} height={CANVAS.height} fill="url(#trace-vignette)" />

        <g>
          {STATIC_EDGES.map((edge) => (
            <StaticEdge
              key={edge.id}
              edge={edge}
              isStatic={prefersReducedMotion}
              isLive={occupants.size > 0}
            />
          ))}
        </g>

        <g>
          {NODES.map((node) => (
            <CircuitNode
              key={node.id}
              node={node}
              occupant={occupants.get(node.id) ?? null}
              isSelected={
                selectedRequestId !== null &&
                occupants.get(node.id)?.requestId === selectedRequestId
              }
              circuitState={
                node.kind === 'provider' ? providerStates?.[node.provider] : undefined
              }
              isStatic={prefersReducedMotion}
              onSelect={onSelect}
            />
          ))}
        </g>

        <g>
          {traces.map((trace) => (
            <RequestPacket
              key={trace.requestId}
              trace={trace}
              isSelected={trace.requestId === selectedRequestId}
              onSelect={onSelect}
            />
          ))}
        </g>
      </svg>

      <Legend />
    </div>
  )
}

/* ── Edges ───────────────────────────────────────────────────────── */

/**
 * Memoised: the static layer is identical between renders unless the reduced-
 * motion setting or the empty/busy state flips, but it re-rendered on every
 * ingested trace event because the canvas above it did. Same for `CircuitNode`
 * and `RequestPacket` — with a full pipeline that is ~20 subtrees rebuilt per
 * frame of stream traffic, for nothing.
 */
const StaticEdge = memo(function StaticEdge({
  edge,
  isStatic,
  isLive,
}: {
  edge: GraphEdge
  isStatic: boolean
  isLive: boolean
}) {
  const isCache = edge.kind === 'cache'

  return (
    <g className={EDGE_TONE[edge.kind]}>
      <path
        d={edge.d}
        fill="none"
        stroke="currentColor"
        strokeWidth={isCache ? 1 : 1.25}
        strokeLinecap="round"
        strokeDasharray={isCache ? '2 7' : undefined}
        opacity={isCache ? 0.3 : 0.8}
      />

      {/* Idle current: a slow dash crawl along the spine so the resting
          canvas is never completely still. Off entirely under reduced motion. */}
      {!isStatic && !isCache && (
        <motion.path
          d={edge.d}
          fill="none"
          className="text-accent"
          stroke="currentColor"
          strokeWidth={1.25}
          strokeLinecap="round"
          strokeDasharray="3 21"
          opacity={isLive ? 0.35 : 0.2}
          animate={{ strokeDashoffset: [0, -48] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: 'linear' }}
        />
      )}
    </g>
  )
})

/* ── Nodes ───────────────────────────────────────────────────────── */

interface CircuitNodeProps {
  node: GraphNode
  occupant: RequestTrace | null
  isSelected: boolean
  circuitState?: CircuitState
  isStatic: boolean
  onSelect: (requestId: string | null) => void
}

const CircuitNode = memo(function CircuitNode({
  node,
  occupant,
  isSelected,
  circuitState,
  isStatic,
  onSelect,
}: CircuitNodeProps) {
  const isBusy = occupant !== null
  const tone =
    node.kind === 'provider'
      ? circuitState
        ? CIRCUIT_TONE[circuitState]
        : IDLE_TONE
      : isBusy
        ? 'text-accent'
        : IDLE_STAGE_TONE

  // Pointer affordance only. Keyboard reaches a request through
  // `TraceRequestList`; see the accessibility note at the top of this file.
  const handleActivate = () => onSelect(occupant ? occupant.requestId : null)

  return (
    <g
      className={cn(tone, 'cursor-pointer')}
      transform={`translate(${node.position.x} ${node.position.y})`}
      onClick={handleActivate}
    >
      <title>{node.hint}</title>

      {/* Breathing halo — the resting canvas has a pulse of its own. */}
      {!isStatic && (
        <motion.circle
          r={node.radius + 6}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          initial={{ opacity: 0.1 }}
          animate={{ opacity: isBusy ? [0.35, 0.1, 0.35] : [0.14, 0.05, 0.14] }}
          transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      {node.kind === 'provider' ? (
        <ProviderShape node={node} isBusy={isBusy} />
      ) : (
        <StageShape isBusy={isBusy} />
      )}

      {isSelected && (
        <circle
          r={node.radius + 11}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="3 4"
          opacity={0.7}
        />
      )}

      <text
        y={node.radius + 22}
        textAnchor="middle"
        className="fill-content-muted font-mono text-[11px] tracking-widest uppercase"
      >
        {node.label}
      </text>

      {node.kind === 'provider' && (
        <text
          y={node.radius + 36}
          textAnchor="middle"
          fill="currentColor"
          className="font-mono text-[9px] tracking-widest uppercase"
          opacity={0.75}
        >
          {circuitState ?? 'idle'}
        </text>
      )}
    </g>
  )
})

/** Providers are circles. Pipeline stages are not — that difference is load-bearing. */
function ProviderShape({ node, isBusy }: { node: ProviderNode; isBusy: boolean }) {
  return (
    <>
      <circle
        r={node.radius}
        className="fill-surface-raised"
        stroke="currentColor"
        strokeWidth={isBusy ? 2 : 1.25}
        opacity={isBusy ? 1 : 0.75}
      />
      <circle r={5} fill="currentColor" opacity={isBusy ? 1 : 0.55} />
    </>
  )
}

function StageShape({ isBusy }: { isBusy: boolean }) {
  return (
    <>
      <rect
        x={-STAGE_SIZE / 2}
        y={-STAGE_SIZE / 2}
        width={STAGE_SIZE}
        height={STAGE_SIZE}
        rx={14}
        className="fill-surface-raised"
        stroke="currentColor"
        strokeWidth={isBusy ? 2 : 1.25}
        opacity={isBusy ? 1 : 0.85}
      />
      <rect
        x={-7}
        y={-7}
        width={14}
        height={14}
        rx={4}
        fill="currentColor"
        opacity={isBusy ? 0.9 : 0.35}
      />
    </>
  )
}

/* ── Legend ──────────────────────────────────────────────────────── */

const LEGEND: { tone: string; label: string }[] = [
  { tone: 'bg-accent', label: 'in flight' },
  { tone: 'bg-status-cached', label: 'cache hit' },
  { tone: 'bg-status-half_open', label: 'fallback' },
  { tone: 'bg-status-success', label: 'complete' },
]

/** Decorative, like the canvas it annotates — the list beside it says this in words. */
function Legend() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute bottom-3 left-4 flex flex-wrap items-center gap-x-4 gap-y-1"
    >
      {LEGEND.map((item) => (
        <span
          key={item.label}
          className="flex items-center gap-1.5 font-mono text-2xs tracking-widest text-content-faint uppercase"
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', item.tone)} />
          {item.label}
        </span>
      ))}
    </div>
  )
}
