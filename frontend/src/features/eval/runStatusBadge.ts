import type { BadgeStatus } from '@/components/ui'
import type { EvalRunStatus } from '@/features/eval/types'

/**
 * Run status → semantic badge token.
 *
 * `running` borrows `half_open` because both mean "in flight, outcome not yet
 * known" and the amber token already carries that reading.
 */
export const RUN_STATUS_BADGE: Record<EvalRunStatus, BadgeStatus> = {
  queued: 'neutral',
  running: 'half_open',
  complete: 'success',
  failed: 'error',
}
