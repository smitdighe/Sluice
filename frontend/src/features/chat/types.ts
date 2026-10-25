/**
 * Chat domain types. Re-exported from the Zod schemas so this file never
 * becomes a second, drifting definition of the wire contract.
 */
export type {
  ChatMetadata,
  ChatRequest,
  ChatResponse,
  FallbackInfo,
  FallbackSkip,
} from '@/api/schemas'

export type { ChatStatus, Classification, Provider } from '@/types/enums'
