import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

export interface PageHeaderProps {
  title: ReactNode
  /** One line of orientation. Optional — not every page needs to explain itself. */
  description?: ReactNode
  /** Small link or label above the title, e.g. the eval detail's "← All runs". */
  eyebrow?: ReactNode
  /** Right-aligned slot: actions, status badges, counters. */
  children?: ReactNode
  className?: string
}

/**
 * The heading block every routed page opens with.
 *
 * The four feature pages were each built in their own phase and had drifted:
 * three different max-widths were fine (they follow content), but three
 * different header markups were not. This fixes the type scale, the gap under
 * the title, and — the part that actually broke — the wrapping behaviour, so a
 * page with a right-hand action still reads correctly at 375px instead of
 * squeezing the title into two words per line.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  children,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        'flex flex-wrap items-end justify-between gap-x-4 gap-y-3',
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && <div className="mb-1">{eyebrow}</div>}
        <h1 className="font-mono text-lg tracking-wide text-content-primary">{title}</h1>
        {description && <p className="mt-1 text-sm text-content-muted">{description}</p>}
      </div>

      {children && (
        <div className="flex shrink-0 flex-wrap items-center gap-3">{children}</div>
      )}
    </header>
  )
}
