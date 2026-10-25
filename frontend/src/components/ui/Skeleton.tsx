import type { ComponentPropsWithRef } from 'react'

import { useReducedMotion } from '@/hooks/useReducedMotion'
import { cn } from '@/lib/cn'

export type SkeletonShape = 'block' | 'text' | 'circle'

export interface SkeletonProps extends ComponentPropsWithRef<'div'> {
  shape?: SkeletonShape
}

const SHAPES: Record<SkeletonShape, string> = {
  block: 'rounded-control',
  text: 'h-3 rounded-full',
  circle: 'aspect-square rounded-full',
}

/**
 * Loading placeholder. The sweep is suppressed entirely when the user asks
 * for reduced motion — a flat block still communicates "pending".
 */
export function Skeleton({ shape = 'block', className, ...props }: SkeletonProps) {
  const prefersReducedMotion = useReducedMotion()

  return (
    <div
      aria-hidden="true"
      className={cn(
        'relative overflow-hidden bg-surface-inset',
        SHAPES[shape],
        className,
      )}
      {...props}
    >
      {!prefersReducedMotion && (
        <div className="absolute inset-0 -translate-x-full animate-shimmer bg-linear-to-r from-transparent via-white/6 to-transparent" />
      )}
    </div>
  )
}
