import type { ComponentPropsWithRef } from 'react'

import { cn } from '@/lib/cn'

/**
 * The visual status vocabulary — deliberately not the domain enums.
 *
 * It is a superset: `CircuitState` maps onto three of these, `ChatStatus` onto
 * three others, `EvalRunStatus` borrows `half_open` for "running". Features
 * declare that mapping themselves (`runStatusBadge.ts`, `STATUS_BADGE` in
 * `ResponseCard`) so this component never imports a backend type and one
 * domain's vocabulary never constrains another's.
 */
export type BadgeStatus =
  'closed' | 'open' | 'half_open' | 'cached' | 'success' | 'error' | 'neutral'

export type BadgeSize = 'sm' | 'md'

export interface BadgeProps extends ComponentPropsWithRef<'span'> {
  status?: BadgeStatus
  size?: BadgeSize
  /** Leading status dot. */
  dot?: boolean
}

/* Full class strings — Tailwind only sees literals, never `bg-status-${x}`. */
const STATUS: Record<BadgeStatus, string> = {
  closed: 'bg-status-closed-soft text-status-closed border-status-closed-line',
  open: 'bg-status-open-soft text-status-open border-status-open-line',
  half_open:
    'bg-status-half_open-soft text-status-half_open border-status-half_open-line',
  cached: 'bg-status-cached-soft text-status-cached border-status-cached-line',
  success: 'bg-status-success-soft text-status-success border-status-success-line',
  error: 'bg-status-error-soft text-status-error border-status-error-line',
  neutral: 'bg-status-neutral-soft text-status-neutral border-status-neutral-line',
}

const SIZES: Record<BadgeSize, string> = {
  sm: 'h-5 gap-1 px-1.5 text-2xs',
  md: 'h-6 gap-1.5 px-2 text-xs',
}

export function Badge({
  status = 'neutral',
  size = 'sm',
  dot = false,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-mono font-medium tracking-wide uppercase',
        STATUS[status],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {dot && (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-current"
        />
      )}
      {children}
    </span>
  )
}
