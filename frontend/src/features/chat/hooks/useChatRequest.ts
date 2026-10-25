import { useMutation, type UseMutationOptions } from '@tanstack/react-query'

import type { ApiClientError } from '@/api/client'
import { postChat } from '@/features/chat/api/chatApi'
import type { ChatRequest, ChatResponse } from '@/features/chat/types'

export const chatKeys = {
  all: ['chat'] as const,
}

type ChatMutationOptions = Omit<
  UseMutationOptions<ChatResponse, ApiClientError, ChatRequest>,
  'mutationFn' | 'mutationKey'
>

/**
 * `POST /v1/chat` as a mutation.
 *
 * Errors surface as `ApiClientError`, already normalised by the client — a
 * caller reads `error.type` / `error.message` and nothing else.
 */
export function useChatRequest(options?: ChatMutationOptions) {
  return useMutation<ChatResponse, ApiClientError, ChatRequest>({
    mutationKey: chatKeys.all,
    mutationFn: (payload) => postChat(payload),
    ...options,
  })
}
