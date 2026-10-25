import type { ReactNode } from 'react'

import type { ApiClientError } from '@/api/client'
import { Button, Card, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'

/**
 * The three states every fetched view owes the user.
 *
 * Shared rather than re-implemented per feature so an error looks and behaves
 * the same on Admin as it does on Eval. All three build on Phase 1 primitives.
 */

export interface ErrorStateProps {
  error: ApiClientError | Error | null
  /** Usually TanStack Query's `refetch`. Omit when there is nothing to retry. */
  onRetry?: () => void
  title?: string
  className?: string
}

function messageOf(error: ErrorStateProps['error']): string {
  if (!error) return 'Something went wrong.'
  return error.message || 'Something went wrong.'
}

function typeOf(error: ErrorStateProps['error']): string | null {
  if (error && 'type' in error && typeof error.type === 'string') return error.type
  return null
}

export function ErrorState({ error, onRetry, title, className }: ErrorStateProps) {
  const errorType = typeOf(error)

  return (
    <Card className={cn('border-status-error-line bg-status-error-soft', className)}>
      <p className="font-mono text-2xs tracking-widest text-status-error uppercase">
        {title ?? 'Request failed'}
      </p>
      <p className="mt-2 text-sm text-content-primary">{messageOf(error)}</p>
      {errorType && (
        <p className="mt-1 font-mono text-2xs text-content-faint">type: {errorType}</p>
      )}
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          Retry
        </Button>
      )}
    </Card>
  )
}

export interface EmptyStateProps {
  title: string
  children?: ReactNode
  action?: ReactNode
  className?: string
}

export function EmptyState({ title, children, action, className }: EmptyStateProps) {
  return (
    <Card padding="lg" className={cn('text-center', className)}>
      <p className="text-sm text-content-secondary">{title}</p>
      {children && <p className="mt-1 text-sm text-content-muted">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </Card>
  )
}

export interface LoadingRowsProps {
  rows?: number
  className?: string
}

/** Generic skeleton block for list/table placeholders. */
export function LoadingRows({ rows = 3, className }: LoadingRowsProps) {
  return (
    <div className={cn('space-y-2', className)} aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  )
}
