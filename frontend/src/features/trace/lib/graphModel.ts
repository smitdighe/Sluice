import { PROVIDERS, type Provider } from '@/types/enums'

/**
 * Static layout for the circuit canvas.
 *
 * Pure data and pure geometry — nothing here imports React, Framer Motion or
 * the trace store. Positions can be retuned without touching a single line of
 * animation code, which is the whole point of the split.
 *
 * MODELLING NOTE — stages and providers are *not* the same thing:
 *
 *   - `classify`, `cache_check`, `route` and `complete` are pipeline nodes.
 *   - `groq`, `cerebras`, `gemini` are provider nodes, id-prefixed `provider:`
 *     so a provider can never be indexed by a stage name (or vice versa) by
 *     accident.
 *   - the remaining two stages on the wire, `call` and `fallback`, are
 *     *transitions*, not nodes: `call` is the route→provider edge, `fallback`
 *     is the provider→provider edge. They deliberately have no node.
 *
 * There are exactly three provider nodes. The old local/offline tier is gone;
 * this list is derived from `PROVIDERS` so it cannot drift from the enum.
 */

export interface Point {
  x: number
  y: number
}

/** User-space coordinates. The SVG scales; these numbers never change. */
export const CANVAS = {
  width: 960,
  height: 430,
  viewBox: '0 0 960 430',
} as const

/* ── Node identity ───────────────────────────────────────────────── */

export type StageNodeId = 'classify' | 'cache_check' | 'route' | 'complete'
export type ProviderNodeId = `provider:${Provider}`
export type NodeId = StageNodeId | ProviderNodeId

const PROVIDER_PREFIX = 'provider:'

export function providerNodeId(provider: Provider): ProviderNodeId {
  return `${PROVIDER_PREFIX}${provider}`
}

export function isProviderNodeId(id: NodeId): id is ProviderNodeId {
  return id.startsWith(PROVIDER_PREFIX)
}

export function providerFromNodeId(id: ProviderNodeId): Provider {
  return id.slice(PROVIDER_PREFIX.length) as Provider
}

interface NodeBase {
  position: Point
  label: string
  /** One line of copy for the tooltip / a11y label. */
  hint: string
  /** Hit radius, and the visual radius for circular nodes. */
  radius: number
}

export interface StageNode extends NodeBase {
  kind: 'stage'
  id: StageNodeId
}

export interface ProviderNode extends NodeBase {
  kind: 'provider'
  id: ProviderNodeId
  provider: Provider
}

export type GraphNode = StageNode | ProviderNode

/* ── Layout ──────────────────────────────────────────────────────── */

const ROW_Y = 215
const STAGE_RADIUS = 26
const PROVIDER_RADIUS = 30

const PROVIDER_COLUMN_X = 640
const PROVIDER_ROW_GAP = 120
/** Centres the provider column on `ROW_Y` regardless of provider count. */
const PROVIDER_TOP_Y = ROW_Y - ((PROVIDERS.length - 1) * PROVIDER_ROW_GAP) / 2

export const STAGE_NODES: StageNode[] = [
  {
    kind: 'stage',
    id: 'classify',
    label: 'classify',
    hint: 'Prompt classified as simple, complex or bulk.',
    position: { x: 90, y: ROW_Y },
    radius: STAGE_RADIUS,
  },
  {
    kind: 'stage',
    id: 'cache_check',
    label: 'cache',
    hint: 'Semantic cache lookup. A hit short-circuits straight to complete.',
    position: { x: 255, y: ROW_Y },
    radius: STAGE_RADIUS,
  },
  {
    kind: 'stage',
    id: 'route',
    label: 'route',
    hint: 'Router picks a provider for this classification.',
    position: { x: 420, y: ROW_Y },
    radius: STAGE_RADIUS,
  },
  {
    kind: 'stage',
    id: 'complete',
    label: 'complete',
    hint: 'Terminus. Every request ends here, cached or called.',
    position: { x: 880, y: ROW_Y },
    radius: STAGE_RADIUS,
  },
]

export const PROVIDER_NODES: ProviderNode[] = PROVIDERS.map((provider, index) => ({
  kind: 'provider',
  id: providerNodeId(provider),
  provider,
  label: provider,
  hint: `Provider ${provider}. Colour reflects its circuit state.`,
  position: {
    x: PROVIDER_COLUMN_X,
    y: PROVIDER_TOP_Y + index * PROVIDER_ROW_GAP,
  },
  radius: PROVIDER_RADIUS,
}))

export const NODES: GraphNode[] = [...STAGE_NODES, ...PROVIDER_NODES]

const NODE_BY_ID = new Map<NodeId, GraphNode>(NODES.map((node) => [node.id, node]))

export function getNode(id: NodeId): GraphNode {
  const node = NODE_BY_ID.get(id)
  // Unreachable through the exported types; a thrown error beats a silent NaN
  // position if a future refactor widens `NodeId`.
  if (!node) throw new Error(`Unknown graph node: ${id}`)
  return node
}

export function nodePosition(id: NodeId): Point {
  return getNode(id).position
}

/* ── Edges ───────────────────────────────────────────────────────── */

export type EdgeKind =
  /** classify → cache_check → route: the spine every request walks. */
  | 'pipeline'
  /** cache_check → complete: the cache-hit short circuit. */
  | 'cache'
  /** route → provider: the `call` stage. */
  | 'dispatch'
  /** provider → complete: the successful return. */
  | 'return'
  /** provider → provider: the `fallback` stage. Drawn only while in use. */
  | 'fallback'

export interface GraphEdge {
  id: string
  from: NodeId
  to: NodeId
  kind: EdgeKind
  /** Quadratic Bézier: start, single control point, end. */
  start: Point
  control: Point
  end: Point
  /** `d` attribute for `<path>`. */
  d: string
  /** Sampled arc length, in user units. Travel duration scales off this. */
  length: number
}

function quadraticPoint(start: Point, control: Point, end: Point, t: number): Point {
  const inv = 1 - t
  return {
    x: inv * inv * start.x + 2 * inv * t * control.x + t * t * end.x,
    y: inv * inv * start.y + 2 * inv * t * control.y + t * t * end.y,
  }
}

const LENGTH_SAMPLES = 32

function quadraticLength(start: Point, control: Point, end: Point): number {
  let total = 0
  let previous = start
  for (let step = 1; step <= LENGTH_SAMPLES; step += 1) {
    const current = quadraticPoint(start, control, end, step / LENGTH_SAMPLES)
    total += Math.hypot(current.x - previous.x, current.y - previous.y)
    previous = current
  }
  return total
}

export function edgeId(from: NodeId, to: NodeId): string {
  return `${from}→${to}`
}

function createEdge(
  from: NodeId,
  to: NodeId,
  kind: EdgeKind,
  control?: Point,
): GraphEdge {
  const start = nodePosition(from)
  const end = nodePosition(to)
  const bend = control ?? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }

  return {
    id: edgeId(from, to),
    from,
    to,
    kind,
    start,
    control: bend,
    end,
    d: `M ${start.x} ${start.y} Q ${bend.x} ${bend.y} ${end.x} ${end.y}`,
    length: quadraticLength(start, bend, end),
  }
}

/**
 * Bows the router fan-out so the three dispatch edges leave `route`
 * horizontally instead of as a hard three-way splay.
 */
function dispatchControl(target: Point): Point {
  const routeAt = nodePosition('route')
  return {
    x: routeAt.x + (target.x - routeAt.x) * 0.5,
    y: routeAt.y + (target.y - routeAt.y) * 0.25,
  }
}

/** Mirror of `dispatchControl`, so the fan-in reads as its reflection. */
function returnControl(source: Point): Point {
  const completeAt = nodePosition('complete')
  return {
    x: source.x + (completeAt.x - source.x) * 0.5,
    y: source.y + (completeAt.y - source.y) * 0.25,
  }
}

/**
 * Fallback arcs bulge to the right of the provider column, into the quieter
 * half of the canvas, and bulge further the more rows they span. They are
 * never part of the resting picture — the canvas draws them only while a
 * packet is rerouting, which is what makes a fallback read as a swerve
 * rather than as one more line.
 */
function fallbackControl(from: Point, to: Point): Point {
  const rows = Math.abs(from.y - to.y) / PROVIDER_ROW_GAP
  return {
    x: PROVIDER_COLUMN_X + 90 + 45 * Math.max(0, rows - 1),
    y: (from.y + to.y) / 2,
  }
}

function buildEdges(): GraphEdge[] {
  const edges: GraphEdge[] = [
    createEdge('classify', 'cache_check', 'pipeline'),
    createEdge('cache_check', 'route', 'pipeline'),
    // Threaded through the gap between the first two provider rows.
    createEdge('cache_check', 'complete', 'cache', { x: 568, y: 85 }),
  ]

  for (const node of PROVIDER_NODES) {
    edges.push(createEdge('route', node.id, 'dispatch', dispatchControl(node.position)))
    edges.push(createEdge(node.id, 'complete', 'return', returnControl(node.position)))
  }

  // Every ordered provider pair: the router may fall back in either direction.
  for (const from of PROVIDER_NODES) {
    for (const to of PROVIDER_NODES) {
      if (from.id === to.id) continue
      edges.push(
        createEdge(
          from.id,
          to.id,
          'fallback',
          fallbackControl(from.position, to.position),
        ),
      )
    }
  }

  return edges
}

export const EDGES: GraphEdge[] = buildEdges()

const EDGE_BY_ID = new Map<string, GraphEdge>(EDGES.map((edge) => [edge.id, edge]))

/** Edges the canvas paints as its resting background. Fallbacks are excluded. */
export const STATIC_EDGES: GraphEdge[] = EDGES.filter((edge) => edge.kind !== 'fallback')

export function findEdge(from: NodeId, to: NodeId): GraphEdge | null {
  return EDGE_BY_ID.get(edgeId(from, to)) ?? null
}

/**
 * Straight fallback geometry for a transition the graph does not model — a
 * dropped event can leave a packet needing to get from A to C with no A→C
 * edge. Moving in a line beats freezing in place.
 */
export function straightEdge(from: NodeId, to: NodeId): GraphEdge {
  return createEdge(from, to, 'pipeline')
}

/** The edge to travel between two nodes, synthesised if it is not modelled. */
export function edgeBetween(from: NodeId, to: NodeId): GraphEdge {
  return findEdge(from, to) ?? straightEdge(from, to)
}

/** Position along an edge. `t` is clamped, so callers need not guard. */
export function pointOnEdge(edge: GraphEdge, t: number): Point {
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t
  return quadraticPoint(edge.start, edge.control, edge.end, clamped)
}
