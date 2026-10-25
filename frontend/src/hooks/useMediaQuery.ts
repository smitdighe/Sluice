import { useCallback, useSyncExternalStore } from 'react'

/**
 * Subscribes to a CSS media query from JS.
 *
 * Tailwind handles every case where a breakpoint only changes *styling*. This
 * exists for the cases where it changes *what is rendered* — the trace canvas
 * is not mounted at all below `lg`, and the sidebar is a drawer rather than a
 * rail below `md`. Rendering both and hiding one with `hidden` would keep an
 * animating SVG alive off-screen, which is exactly what this avoids.
 *
 * Same `useSyncExternalStore` shape as `useReducedMotion` — no effect, no
 * initial-render flash, and it tracks changes (including a window resize)
 * instead of sampling once on mount.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const mediaQuery = getMediaQuery(query)
      if (!mediaQuery) return () => {}

      mediaQuery.addEventListener('change', onStoreChange)
      return () => mediaQuery.removeEventListener('change', onStoreChange)
    },
    [query],
  )

  const getSnapshot = useCallback(() => getMediaQuery(query)?.matches ?? false, [query])

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

function getMediaQuery(query: string): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null
  }
  return window.matchMedia(query)
}

/** SSR and tests have no viewport; report "not matching" rather than guessing. */
function getServerSnapshot(): boolean {
  return false
}

/**
 * The two breakpoints that change structure, named once so a component never
 * hard-codes a pixel value that drifts from `tailwind`'s own scale.
 *
 * These mirror Tailwind's defaults: `md` = 48rem, `lg` = 64rem.
 */
export const MEDIA = {
  /** True at `md` and up — the sidebar is a persistent rail. */
  mdUp: '(min-width: 48rem)',
  /** True at `lg` and up — the trace canvas is worth rendering. */
  lgUp: '(min-width: 64rem)',
} as const
