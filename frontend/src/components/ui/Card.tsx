import type { ComponentPropsWithRef } from 'react'

import { cn } from '@/lib/cn'

export type CardPadding = 'none' | 'sm' | 'md' | 'lg'

export interface CardProps extends ComponentPropsWithRef<'div'> {
  padding?: CardPadding
  /** Adds hover affordance. Use only when the whole card is clickable. */
  interactive?: boolean
}

const PADDING: Record<CardPadding, string> = {
  none: 'p-0',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
}

export function Card({
  padding = 'md',
  interactive = false,
  className,
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        'rounded-card border border-surface-line bg-surface-raised shadow-card',
        PADDING[padding],
        interactive &&
          'cursor-pointer transition-colors duration-100 ease-out ' +
            'hover:border-surface-line-strong hover:bg-surface-overlay',
        className,
      )}
      {...props}
    />
  )
}
