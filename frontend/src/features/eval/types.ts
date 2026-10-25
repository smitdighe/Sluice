/**
 * Eval domain types. Re-exported from the Zod schemas so this file never
 * becomes a second, drifting definition of the wire contract.
 */
export type {
  EvalAggregates,
  EvalRun,
  EvalRunCreated,
  EvalRunDetail,
  EvalRunList,
  EvalScore,
} from '@/api/schemas'

export type { EvalRunRequest } from '@/features/eval/api/evalApi'
export type { EvalRunStatus } from '@/types/enums'
