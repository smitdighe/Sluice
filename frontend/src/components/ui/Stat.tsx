import { cn } from '@/lib/cn'

export type StatSize = 'sm' | 'lg'

export interface StatProps {
  label: string
  value: string
  /** Rendered instead of `value` when the metric is dimmed (e.g. unscored). */
  muted?: boolean
  size?: StatSize
  /** Overrides the hover title, which defaults to the full untruncated value. */
  title?: string
  className?: string
}

/**
 * Label-over-value pair — the atom every metric readout in the app is built
 * from.
 *
 * Extracted because chat, admin and eval had each grown their own private
 * copy with slightly different tracking and margins. One definition means one
 * typographic decision: `tracking-wide` for the label (it sits inline, beside
 * others) versus the `tracking-widest` reserved for panel titles.
 *
 * The value truncates rather than wrapping. Request ids and token counts are
 * long, the grid cells they sit in are narrow at 375px, and a wrapped mono
 * value breaks the row rhythm — the full string stays available on hover and
 * to a screen reader via `title`.
 */
export function Stat({
  label,
  value,
  muted = false,
  size = 'sm',
  title,
  className,
}: StatProps) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="font-mono text-2xs tracking-wide text-content-faint uppercase">
        {label}
      </p>
      <p
        className={cn(
          'mt-0.5 truncate font-mono',
          size === 'lg' ? 'text-xl' : 'text-sm',
          muted ? 'text-content-faint' : 'text-content-primary',
        )}
        title={title ?? value}
      >
        {value}
      </p>
    </div>
  )
}
