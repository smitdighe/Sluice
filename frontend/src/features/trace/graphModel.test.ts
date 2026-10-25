import { describe, expect, it } from 'vitest'

import {
  EDGES,
  PROVIDER_NODES,
  STAGE_NODES,
  STATIC_EDGES,
  edgeBetween,
  findEdge,
  isProviderNodeId,
  nodePosition,
  pointOnEdge,
  providerFromNodeId,
  providerNodeId,
} from '@/features/trace/lib/graphModel'
import { PROVIDERS } from '@/types/enums'

describe('graph nodes', () => {
  it('has exactly one node per provider and no more', () => {
    expect(PROVIDER_NODES).toHaveLength(PROVIDERS.length)
    expect(PROVIDER_NODES.map((node) => node.provider)).toEqual([...PROVIDERS])
  })

  it('models the three providers only — no local/offline tier', () => {
    expect(PROVIDER_NODES.map((node) => node.provider)).toEqual([
      'groq',
      'cerebras',
      'gemini',
    ])
  })

  it('keeps stages and providers in separate id namespaces', () => {
    for (const stage of STAGE_NODES) {
      expect(isProviderNodeId(stage.id)).toBe(false)
    }
    for (const provider of PROVIDER_NODES) {
      expect(isProviderNodeId(provider.id)).toBe(true)
      expect(providerFromNodeId(provider.id)).toBe(provider.provider)
    }
  })

  it('models call and fallback as transitions, not nodes', () => {
    const stageIds = STAGE_NODES.map((node) => node.id) as string[]
    expect(stageIds).toEqual(['classify', 'cache_check', 'route', 'complete'])
    expect(stageIds).not.toContain('call')
    expect(stageIds).not.toContain('fallback')
  })

  it('centres the provider column on the pipeline row', () => {
    const ys = PROVIDER_NODES.map((node) => node.position.y)
    const middle = (Math.min(...ys) + Math.max(...ys)) / 2
    expect(middle).toBe(nodePosition('route').y)
  })
})

describe('graph edges', () => {
  it('dispatches from route to every provider', () => {
    for (const provider of PROVIDERS) {
      const edge = findEdge('route', providerNodeId(provider))
      expect(edge?.kind).toBe('dispatch')
    }
  })

  it('returns from every provider to the shared terminus', () => {
    for (const provider of PROVIDERS) {
      const edge = findEdge(providerNodeId(provider), 'complete')
      expect(edge?.kind).toBe('return')
    }
  })

  it('has a fallback edge for every ordered provider pair', () => {
    const fallbacks = EDGES.filter((edge) => edge.kind === 'fallback')
    expect(fallbacks).toHaveLength(PROVIDERS.length * (PROVIDERS.length - 1))

    for (const from of PROVIDERS) {
      for (const to of PROVIDERS) {
        if (from === to) continue
        expect(findEdge(providerNodeId(from), providerNodeId(to))?.kind).toBe('fallback')
      }
    }
  })

  it('never gives a provider a fallback edge to itself', () => {
    for (const provider of PROVIDERS) {
      const id = providerNodeId(provider)
      expect(findEdge(id, id)).toBeNull()
    }
  })

  it('models the cache short circuit straight to complete', () => {
    expect(findEdge('cache_check', 'complete')?.kind).toBe('cache')
  })

  it('excludes fallback edges from the resting picture', () => {
    expect(STATIC_EDGES.every((edge) => edge.kind !== 'fallback')).toBe(true)
    expect(STATIC_EDGES.length).toBeLessThan(EDGES.length)
  })

  it('never routes a provider straight back to the router', () => {
    for (const provider of PROVIDERS) {
      expect(findEdge(providerNodeId(provider), 'route')).toBeNull()
    }
  })

  it('synthesises a straight edge for an unmodelled transition', () => {
    expect(findEdge('classify', 'complete')).toBeNull()

    const edge = edgeBetween('classify', 'complete')
    expect(edge.start).toEqual(nodePosition('classify'))
    expect(edge.end).toEqual(nodePosition('complete'))
  })
})

describe('pointOnEdge', () => {
  const edge = findEdge('classify', 'cache_check')!

  it('starts and ends on its node centres', () => {
    expect(pointOnEdge(edge, 0)).toEqual(nodePosition('classify'))
    expect(pointOnEdge(edge, 1)).toEqual(nodePosition('cache_check'))
  })

  it('clamps out-of-range progress instead of extrapolating', () => {
    expect(pointOnEdge(edge, -3)).toEqual(pointOnEdge(edge, 0))
    expect(pointOnEdge(edge, 7)).toEqual(pointOnEdge(edge, 1))
  })

  it('advances monotonically along the cache short circuit', () => {
    const cache = findEdge('cache_check', 'complete')!
    let previousX = -Infinity

    for (let step = 0; step <= 10; step += 1) {
      const point = pointOnEdge(cache, step / 10)
      expect(point.x).toBeGreaterThan(previousX)
      previousX = point.x
    }
  })

  it('threads the cache short circuit between the first two provider rows', () => {
    const cache = findEdge('cache_check', 'complete')!
    const [first, second] = PROVIDER_NODES

    // Sample the arc where it crosses the provider column.
    const crossing = Array.from({ length: 201 }, (_, step) =>
      pointOnEdge(cache, step / 200),
    ).reduce((closest, point) =>
      Math.abs(point.x - first.position.x) < Math.abs(closest.x - first.position.x)
        ? point
        : closest,
    )

    expect(crossing.y).toBeGreaterThan(first.position.y + first.radius)
    expect(crossing.y).toBeLessThan(second.position.y - second.radius)
  })

  it('reports a length no shorter than the straight line between its ends', () => {
    for (const candidate of EDGES) {
      const straight = Math.hypot(
        candidate.end.x - candidate.start.x,
        candidate.end.y - candidate.start.y,
      )
      expect(candidate.length).toBeGreaterThanOrEqual(straight - 0.001)
    }
  })
})
