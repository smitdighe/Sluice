import { useSyncExternalStore } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

function getMediaQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null
  }
  return window.matchMedia(QUERY)
}

function subscribe(onStoreChange: () => void): () => void {
  const mediaQuery = getMediaQuery()
  if (!mediaQuery) return () => {}

  mediaQuery.addEventListener('change', onStoreChange)
  return () => mediaQuery.removeEventListener('change', onStoreChange)
}

function getSnapshot(): boolean {
  return getMediaQuery()?.matches ?? false
}

function getServerSnapshot(): boolean {
  return false
}

/**
 * Tracks the OS-level `prefers-reduced-motion` setting and re-renders when
 * the user changes it mid-session.
 *
 * Animation-heavy components should branch on this rather than assuming the
 * CSS guard in `styles/index.css` covers them — that guard only reaches CSS
 * animations, not JS-driven ones.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
