import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'

import { CommandPalette } from '@/app/layout/CommandPalette'
import { MenuIcon, SearchIcon } from '@/app/layout/NavIcons'
import { Sidebar } from '@/app/layout/Sidebar'
import { HEALTH_POLL_MS, useHealth } from '@/hooks/useHealth'
import { MEDIA, useMediaQuery } from '@/hooks/useMediaQuery'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { cn } from '@/lib/cn'
import { transitionBase, transitionExit } from '@/lib/animationVariants'
import { useUiStore } from '@/store/uiStore'

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /mac|iphone|ipad/i.test(navigator.userAgent)
}

/**
 * Persistent chrome: top bar, sidebar, routed content.
 *
 * Every route renders inside this, including the 404, so navigation is never
 * a dead end.
 *
 * The sidebar has two distinct behaviours, not one responsive width. At `md`
 * and up it is a persistent rail that collapses to icons; below `md` a 64px
 * rail would eat a fifth of a 375px viewport for no benefit, so it becomes an
 * overlay drawer that is closed by default and dismisses on navigate. Both are
 * driven by the same top-bar button — the user sees one control either way.
 */
export function AppShell() {
  const isDesktop = useMediaQuery(MEDIA.mdUp)

  // Two states rather than one: "collapsed rail" and "open drawer" are
  // different questions, and conflating them makes the breakpoint crossing
  // behave unpredictably.
  const [isRailExpanded, setRailExpanded] = useState(true)
  const [isDrawerOpen, setDrawerOpen] = useState(false)
  const [isMac] = useState(isMacPlatform)

  const toggleCommandPalette = useUiStore((state) => state.toggleCommandPalette)

  // Crossing `md` in either direction dismisses the drawer, so it cannot be
  // left armed to reappear on the way back. Adjusted during render rather than
  // in an effect — this is derived from the breakpoint, not a synchronisation
  // with anything external, and an effect here would cost a second render.
  const [lastIsDesktop, setLastIsDesktop] = useState(isDesktop)
  if (lastIsDesktop !== isDesktop) {
    setLastIsDesktop(isDesktop)
    setDrawerOpen(false)
  }

  // ⌘K / Ctrl+K from anywhere in the app.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== 'k') return
      if (!event.metaKey && !event.ctrlKey) return
      event.preventDefault()
      toggleCommandPalette()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleCommandPalette])

  const sidebarIsOpen = isDesktop ? isRailExpanded : isDrawerOpen

  function toggleSidebar() {
    if (isDesktop) {
      setRailExpanded((value) => !value)
      return
    }
    setDrawerOpen((value) => !value)
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {/* First tab stop on every page — the sidebar is 4 links deep and a
          keyboard user should not have to walk it to reach the content. */}
      <a
        href="#main-content"
        className={cn(
          'sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-60',
          'focus:rounded-control focus:border focus:border-surface-line',
          'focus:bg-surface-overlay focus:px-3 focus:py-2 focus:text-sm focus:text-content-primary',
        )}
      >
        Skip to content
      </a>

      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-surface-line bg-surface-raised px-3 sm:gap-3">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={sidebarIsOpen ? 'Collapse navigation' : 'Expand navigation'}
          aria-expanded={sidebarIsOpen}
          aria-controls="primary-navigation"
          className="rounded-control p-2 text-content-muted transition-colors duration-100 hover:bg-surface-overlay hover:text-content-primary"
        >
          <MenuIcon className="h-4 w-4" aria-hidden="true" />
        </button>

        <span className="font-mono text-sm tracking-widest text-content-primary uppercase">
          Sluice
        </span>

        <div className="flex-1" />

        <HealthIndicator />

        <button
          type="button"
          onClick={toggleCommandPalette}
          aria-haspopup="dialog"
          aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
          className={cn(
            'inline-flex items-center gap-2 rounded-control border border-surface-line',
            'bg-surface-inset px-2.5 py-1.5 text-xs text-content-muted',
            'transition-colors duration-100 hover:border-surface-line-strong hover:text-content-secondary',
          )}
        >
          <SearchIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {/* The label is the button's accessible name at every width; only
              its visual presence is dropped on a narrow bar. */}
          <span className="sr-only sm:not-sr-only">Search</span>
          <kbd className="rounded border border-surface-line bg-surface-base px-1 font-mono text-2xs">
            {isMac ? '⌘' : 'Ctrl'}K
          </kbd>
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {isDesktop && (
          <Sidebar
            id="primary-navigation"
            collapsed={!isRailExpanded}
            className="shrink-0"
          />
        )}

        <main
          id="main-content"
          tabIndex={-1}
          className="min-w-0 flex-1 overflow-y-auto focus:outline-none"
        >
          <Outlet />
        </main>
      </div>

      {!isDesktop && (
        <NavigationDrawer isOpen={isDrawerOpen} onClose={() => setDrawerOpen(false)} />
      )}

      <CommandPalette />
    </div>
  )
}

/* ── Mobile drawer ───────────────────────────────────────────────── */

function NavigationDrawer({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const prefersReducedMotion = useReducedMotion()

  useEffect(() => {
    if (!isOpen) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onClose])

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-40 flex md:hidden"
          initial={{ opacity: prefersReducedMotion ? 1 : 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: prefersReducedMotion ? 1 : 0 }}
          transition={prefersReducedMotion ? { duration: 0 } : transitionExit}
        >
          <div
            className="absolute inset-0 bg-black/60"
            aria-hidden="true"
            onClick={onClose}
          />

          {/* Reduced motion snaps the panel into place; it does not slide in
              faster. `x: 0` on both keyframes means there is no travel at all. */}
          <motion.div
            className="relative z-10 h-full"
            initial={{ x: prefersReducedMotion ? 0 : '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: prefersReducedMotion ? 0 : '-100%' }}
            transition={prefersReducedMotion ? { duration: 0 } : transitionBase}
          >
            <Sidebar
              id="primary-navigation"
              collapsed={false}
              onNavigate={onClose}
              autoFocus
              className="h-full w-64 shadow-overlay"
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ── Liveness ────────────────────────────────────────────────────── */

/**
 * Top-bar liveness dot.
 *
 * The dot is the sighted affordance; the `role="status"` line beside it is the
 * same fact for a screen reader, announced only when the state actually
 * changes. Polling every 10s must not mean announcing every 10s, so the live
 * region's text is derived from the status alone — a successful re-poll
 * renders an identical string and produces no announcement.
 */
function HealthIndicator() {
  const health = useHealth()

  const { dot, label } = health.isSuccess
    ? { dot: 'bg-status-success', label: 'Online' }
    : health.isError
      ? { dot: 'bg-status-error', label: 'Offline' }
      : { dot: 'bg-status-neutral', label: 'Checking' }

  return (
    <>
      <span
        aria-hidden="true"
        className="inline-flex items-center gap-2 rounded-full border border-surface-line px-2.5 py-1 font-mono text-2xs tracking-wide text-content-muted uppercase"
        title={
          health.isError
            ? (health.error?.message ?? 'Backend unreachable.')
            : `Polling /v1/health every ${HEALTH_POLL_MS / 1000}s.`
        }
      >
        <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
        <span className="hidden sm:inline">{label}</span>
      </span>

      <span role="status" aria-live="polite" className="sr-only">
        {`Backend ${label.toLowerCase()}.`}
      </span>
    </>
  )
}
