import { apiPost, CHAT_TIMEOUT_MS } from '@/api/client'
import { ChatResponseSchema, type ChatRequest, type ChatResponse } from '@/api/schemas'

/**
 * `POST /v1/chat`
 *
 * Uses the long chat timeout by default — the request fans out to an upstream
 * LLM. Pass `{ timeout }` in `config` to override, or a `signal` to cancel.
 */
export function postChat(
  payload: ChatRequest,
  config?: { signal?: AbortSignal; timeout?: number },
): Promise<ChatResponse> {
  return apiPost('/v1/chat', payload, ChatResponseSchema, {
    timeout: CHAT_TIMEOUT_MS,
    ...config,
  })
}
