import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { NAV_ITEMS, type NavItem } from '@/app/navigation'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { fadeVariants, overlayVariants, resolveVariants } from '@/lib/animationVariants'
import { cn } from '@/lib/cn'
import { useUiStore } from '@/store/uiStore'

/**
 * ⌘K / Ctrl+K palette.
 *
 * Static destination list for now — plain substring filtering over label and
 * keywords, no fuzzy ranking. Commands beyond navigation come later.
 *
 * Built as a combobox rather than a list of buttons: the input keeps focus and
 * owns the selection via `aria-activedescendant`, which is what lets a screen
 * reader announce each destination as the user arrows through it. Options are
 * plain `<li role="option">` for the same reason — a focusable control inside
 * an option is invalid and confuses the announcement.
 */

function matches(item: NavItem, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  if (item.label.toLowerCase().includes(needle)) return true
  if (item.to.toLowerCase().includes(needle)) return true
  return item.keywords.some((keyword) => keyword.includes(needle))
}

export function CommandPalette() {
  const isOpen = useUiStore((state) => state.isCommandPaletteOpen)

  // The dialog is mounted only while open, so query/highlight state is fresh on
  // every open without an effect resetting it. `AnimatePresence` lives out here
  // so the exit animation still has something to play.
  return <AnimatePresence>{isOpen && <CommandPaletteDialog />}</AnimatePresence>
}

function CommandPaletteDialog() {
  const setOpen = useUiStore((state) => state.setCommandPaletteOpen)
  const navigate = useNavigate()
  const prefersReducedMotion = useReducedMotion()

  const baseId = useId()
  const listId = `${baseId}-results`
  const optionId = (index: number) => `${baseId}-option-${index}`

  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  /** Whatever had focus when the palette opened, so it can be handed back. */
  const restoreFocusRef = useRef<HTMLElement | null>(
    typeof document === 'undefined'
      ? null
      : (document.activeElement as HTMLElement | null),
  )

  const results = useMemo(() => NAV_ITEMS.filter((item) => matches(item, query)), [query])

  // Derived, not stored: filtering can shrink the list out from under the
  // highlight, and clamping here avoids a second render to correct it.
  const activeIndex = highlighted < results.length ? highlighted : 0

  // DOM focus only — no state is set here.
  useEffect(() => {
    inputRef.current?.focus()
    const restore = restoreFocusRef.current
    return () => restore?.focus?.()
  }, [])

  // Keep the highlighted option in view when arrowing past the visible window.
  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    active?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  function close() {
    setOpen(false)
  }

  function select(item: NavItem | undefined) {
    if (!item) return
    void navigate(item.to)
    close()
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    // Focus stays in the dialog while it is open. Escape is the exit, so this
    // is a modal, not a keyboard trap.
    if (event.key === 'Tab') {
      event.preventDefault()
      inputRef.current?.focus()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlighted(results.length ? (activeIndex + 1) % results.length : 0)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlighted(
        results.length ? (activeIndex - 1 + results.length) % results.length : 0,
      )
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      setHighlighted(0)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      setHighlighted(Math.max(0, results.length - 1))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      select(results[activeIndex])
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[12vh]"
      variants={resolveVariants(fadeVariants, prefersReducedMotion)}
      initial="hidden"
      animate="visible"
      exit="exit"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={onKeyDown}
        variants={resolveVariants(overlayVariants, prefersReducedMotion)}
        className="w-full max-w-lg overflow-hidden rounded-card border border-surface-line bg-surface-overlay shadow-overlay"
      >
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Go to…"
          aria-label="Search destinations"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={results.length ? optionId(activeIndex) : undefined}
          autoComplete="off"
          data-focus-ring="none"
          className={cn(
            'w-full border-b border-surface-line bg-transparent px-4 py-3',
            'font-mono text-sm text-content-primary placeholder:text-content-faint',
            'outline-none',
          )}
        />

        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Destinations"
          className="max-h-72 overflow-y-auto p-1"
        >
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-content-muted">
              No destinations match “{query}”.
            </li>
          )}

          {results.map((item, index) => {
            const Icon = item.icon
            const isHighlighted = index === activeIndex

            return (
              <li
                key={item.to}
                id={optionId(index)}
                role="option"
                aria-selected={isHighlighted}
                data-active={isHighlighted}
                onMouseEnter={() => setHighlighted(index)}
                // Keeps focus (and therefore `aria-activedescendant`) on the input.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(item)}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-3 rounded-control px-3 py-2 text-left text-sm',
                  isHighlighted
                    ? 'bg-accent-soft text-content-primary'
                    : 'text-content-secondary',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="flex-1">{item.label}</span>
                <span className="font-mono text-2xs text-content-faint">{item.to}</span>
              </li>
            )
          })}
        </ul>
      </motion.div>
    </motion.div>
  )
}
