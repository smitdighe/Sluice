import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'

import { FAST_MS } from '@/lib/animationVariants'
import { cn } from '@/lib/cn'

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right'

export interface TooltipProps {
  /** Tooltip body. Keep it short — this is not a popover. */
  content: ReactNode
  side?: TooltipSide
  /** Hover dwell before showing. Focus always shows immediately. */
  delayMs?: number
  /** Class for the wrapper, not the bubble. */
  className?: string
  children: ReactNode
}

const SIDES: Record<TooltipSide, string> = {
  top: 'bottom-full left-1/2 mb-2 -translate-x-1/2',
  bottom: 'top-full left-1/2 mt-2 -translate-x-1/2',
  left: 'right-full top-1/2 mr-2 -translate-y-1/2',
  right: 'left-full top-1/2 ml-2 -translate-y-1/2',
}

export function Tooltip({
  content,
  side = 'top',
  delayMs = FAST_MS,
  className,
  children,
}: TooltipProps) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clear = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const show = useCallback(
    (immediate = false) => {
      clear()
      if (immediate || delayMs <= 0) {
        setOpen(true)
        return
      }
      timer.current = setTimeout(() => setOpen(true), delayMs)
    },
    [clear, delayMs],
  )

  const hide = useCallback(() => {
    clear()
    setOpen(false)
  }, [clear])

  useEffect(() => clear, [clear])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, hide])

  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => show()}
      onMouseLeave={hide}
      onFocus={() => show(true)}
      onBlur={hide}
    >
      {/* aria-describedby only while visible, so SRs don't announce a hidden bubble */}
      <span aria-describedby={open ? id : undefined} className="inline-flex">
        {children}
      </span>

      <span
        id={id}
        role="tooltip"
        aria-hidden={!open}
        className={cn(
          'pointer-events-none absolute z-50 w-max max-w-56 rounded-control',
          'border border-surface-line bg-surface-overlay px-2 py-1',
          'text-xs leading-snug text-content-primary shadow-overlay',
          'transition-opacity duration-100 ease-out',
          SIDES[side],
          open ? 'opacity-100' : 'invisible opacity-0',
        )}
      >
        {content}
      </span>
    </span>
  )
}
