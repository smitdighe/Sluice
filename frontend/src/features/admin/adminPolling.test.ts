import { describe, expect, it, vi } from 'vitest'

/**
 * Polling behaviour, asserted without a DOM.
 *
 * Three notes on how this is set up:
 *
 * 1. TanStack Query disables every timer it owns when `typeof window ===
 *    'undefined'` (its `isServer` guard), and this suite runs in the `node`
 *    environment. Hence the shim below.
 *
 * 2. The shim has to be in place before react-query is *evaluated*, so every
 *    import here is dynamic. A static `import` of any app module that pulls in
 *    react-query — `useAdminData` does — would be hoisted above the shim and
 *    leave the scheduler permanently disabled, with the tests failing for a
 *    reason that has nothing to do with the code under test.
 *
 * 3. The intervals exercised are milliseconds, not the real 5s/15s/30s: what
 *    needs proving is that a subscribed observer refetches on its interval and
 *    stops while unfocused, which is interval-independent. The production
 *    values are asserted separately.
 *
 * `QueryObserver` is the machinery `useQuery` drives, so this exercises the
 * real scheduler rather than a re-description of the options object.
 */
;(globalThis as unknown as { window: unknown }).window = globalThis

const TICK_MS = 25

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const loadQueryRuntime = () => import('@tanstack/react-query')

describe('polling cadence', () => {
  it('orders the intervals by how fast each number actually moves', async () => {
    const { PROVIDER_POLL_MS, QUOTA_POLL_MS, CACHE_POLL_MS } =
      await import('@/features/admin/hooks/useAdminData')
    const { HEALTH_POLL_MS } = await import('@/hooks/useHealth')

    // Provider circuits flip on a single failed call — and colour the trace
    // canvas — so they are the fastest. Cache ratios barely move, so slowest.
    expect(PROVIDER_POLL_MS).toBeLessThan(QUOTA_POLL_MS)
    expect(QUOTA_POLL_MS).toBeLessThan(CACHE_POLL_MS)

    // Health is the top-bar dot: quicker than the slow dashboards, no quicker
    // than the circuit states.
    expect(HEALTH_POLL_MS).toBeGreaterThan(PROVIDER_POLL_MS)
    expect(HEALTH_POLL_MS).toBeLessThan(CACHE_POLL_MS)
  })

  it('refetches repeatedly while subscribed', async () => {
    const { QueryClient, QueryObserver, focusManager } = await loadQueryRuntime()
    focusManager.setFocused(true)

    const client = new QueryClient()
    const queryFn = vi.fn(async () => 'ok')
    const observer = new QueryObserver(client, {
      queryKey: ['polling-probe', 'repeat'],
      queryFn,
      refetchInterval: TICK_MS,
      retry: false,
    })

    const unsubscribe = observer.subscribe(() => {})
    await wait(TICK_MS)
    expect(queryFn).toHaveBeenCalledTimes(1) // mount fetch only

    await wait(TICK_MS * 5)
    expect(queryFn.mock.calls.length).toBeGreaterThan(3)

    unsubscribe()
    client.clear()
    focusManager.setFocused(undefined)
  })

  it('suspends polling while the window is unfocused, and resumes after', async () => {
    const { QueryClient, QueryObserver, focusManager } = await loadQueryRuntime()
    focusManager.setFocused(true)

    const client = new QueryClient()
    const queryFn = vi.fn(async () => 'ok')
    const observer = new QueryObserver(client, {
      queryKey: ['polling-probe', 'background'],
      queryFn,
      refetchInterval: TICK_MS,
      retry: false,
    })

    const unsubscribe = observer.subscribe(() => {})
    await wait(TICK_MS * 5)
    const whileFocused = queryFn.mock.calls.length
    expect(whileFocused).toBeGreaterThan(1)

    /*
     * `refetchIntervalInBackground` is left at its default `false`, so this
     * pause is the library's own work — the app hand-rolls no visibility
     * detection anywhere.
     */
    focusManager.setFocused(false)
    await wait(TICK_MS * 5)
    expect(queryFn).toHaveBeenCalledTimes(whileFocused)

    focusManager.setFocused(true)
    await wait(TICK_MS * 3)
    expect(queryFn.mock.calls.length).toBeGreaterThan(whileFocused)

    unsubscribe()
    client.clear()
    focusManager.setFocused(undefined)
  })

  it('stops polling once nothing is subscribed', async () => {
    const { QueryClient, QueryObserver, focusManager } = await loadQueryRuntime()
    focusManager.setFocused(true)

    const client = new QueryClient()
    const queryFn = vi.fn(async () => 'ok')
    const observer = new QueryObserver(client, {
      queryKey: ['polling-probe', 'unsubscribe'],
      queryFn,
      refetchInterval: TICK_MS,
      retry: false,
    })

    const unsubscribe = observer.subscribe(() => {})
    await wait(TICK_MS * 4)
    unsubscribe()

    const whileSubscribed = queryFn.mock.calls.length
    await wait(TICK_MS * 5)

    expect(queryFn).toHaveBeenCalledTimes(whileSubscribed)

    client.clear()
    focusManager.setFocused(undefined)
  })
})
