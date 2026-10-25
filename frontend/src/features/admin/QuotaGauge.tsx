import { memo } from 'react'

import { Card } from '@/components/ui'
import type { QuotaEntry } from '@/features/admin/types'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { cn } from '@/lib/cn'

export interface QuotaGaugeProps {
  entry: QuotaEntry
}

/** Amber past 75%, red past 90% — read the bar without reading the number. */
function fillClass(ratio: number): string {
  if (ratio >= 0.9) return 'bg-status-open'
  if (ratio >= 0.75) return 'bg-status-half_open'
  return 'bg-status-closed'
}

/**
 * Memoised against the 15s quota poll — see `CircuitBreakerCard` for why that
 * is enough to keep an unchanged provider from re-rendering.
 */
export const QuotaGauge = memo(function QuotaGauge({ entry }: QuotaGaugeProps) {
  const prefersReducedMotion = useReducedMotion()

  const hasBudget = entry.token_budget > 0
  // Guard the divide: an unmetered provider reports a 0 budget.
  const ratio = hasBudget ? entry.tokens_used / entry.token_budget : 0
  const clamped = Math.max(0, Math.min(1, ratio))
  const percent = Math.round(clamped * 1000) / 10

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-mono text-sm text-content-primary">{entry.provider}</p>
        <p className="font-mono text-2xs text-content-muted">
          {hasBudget ? `${percent}%` : 'unmetered'}
        </p>
      </div>

      <div
        role="meter"
        aria-valuenow={hasBudget ? percent : 0}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${entry.provider} quota used`}
        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-inset"
      >
        {/*
         * The width eases between polls so a jump from 40% to 55% reads as the
         * bar filling rather than as a flicker. Deliberately slow and
         * opacity-free: this is a background dashboard, not the canvas, and
         * the "signature element restrained" rule means nothing here competes
         * with the trace view for attention.
         *
         * Under reduced motion the class is dropped entirely — the bar snaps
         * to its new value. Not a shorter tween: no tween.
         */}
        <div
          className={cn(
            'h-full rounded-full',
            !prefersReducedMotion && 'transition-[width] duration-500 ease-out',
            hasBudget ? fillClass(clamped) : 'bg-surface-line-strong',
          )}
          style={{ width: `${hasBudget ? clamped * 100 : 0}%` }}
        />
      </div>

      <p className="mt-3 font-mono text-2xs text-content-faint">
        {entry.tokens_used.toLocaleString()} /{' '}
        {hasBudget ? entry.token_budget.toLocaleString() : '∞'} tokens
      </p>
      <p className="mt-1 font-mono text-2xs text-content-faint">
        {new Date(entry.period_start).toLocaleDateString()} –{' '}
        {new Date(entry.period_end).toLocaleDateString()}
      </p>
    </Card>
  )
})
