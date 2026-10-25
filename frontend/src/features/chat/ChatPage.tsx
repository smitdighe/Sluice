import { useState } from 'react'

import { PageHeader } from '@/app/layout/PageHeader'
import { ErrorState } from '@/components/feedback/QueryStates'
import { Card, Skeleton } from '@/components/ui'
import { ChatComposer } from '@/features/chat/ChatComposer'
import { ResponseCard } from '@/features/chat/ResponseCard'
import { useChatRequest } from '@/features/chat/hooks/useChatRequest'
import type { ChatRequest, ChatResponse } from '@/features/chat/types'

interface Exchange {
  /** `request_id` is unique per response and makes a stable React key. */
  id: string
  prompt: string
  response: ChatResponse
}

function PendingCard() {
  return (
    <Card aria-busy="true">
      <Skeleton shape="text" className="w-24" />
      <div className="mt-4 flex gap-2">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <div className="mt-4 space-y-2">
        <Skeleton shape="text" className="w-full" />
        <Skeleton shape="text" className="w-11/12" />
        <Skeleton shape="text" className="w-2/3" />
      </div>
    </Card>
  )
}

export function ChatPage() {
  // Session-only history. Nothing is persisted; a reload starts clean.
  const [exchanges, setExchanges] = useState<Exchange[]>([])
  const [lastPrompt, setLastPrompt] = useState('')

  const chat = useChatRequest({
    onSuccess: (response, variables) => {
      setExchanges((current) => [
        { id: response.request_id, prompt: variables.prompt, response },
        ...current,
      ])
    },
  })

  function handleSubmit(payload: ChatRequest) {
    setLastPrompt(payload.prompt)
    chat.mutate(payload)
  }

  return (
    <section className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <PageHeader
        title="Chat Playground"
        description="Send a prompt through the router and inspect how it was handled."
      />

      <ChatComposer onSubmit={handleSubmit} isPending={chat.isPending} />

      {/* Announced rather than only spun: a routed request can take many
          seconds, and the skeleton says nothing to a screen reader. */}
      <span role="status" aria-live="polite" className="sr-only">
        {chat.isPending ? 'Routing your prompt.' : ''}
      </span>

      {chat.isPending && <PendingCard />}

      {chat.isError && (
        <ErrorState
          error={chat.error}
          title="Chat request failed"
          onRetry={lastPrompt ? () => chat.mutate({ prompt: lastPrompt }) : undefined}
        />
      )}

      {exchanges.length === 0 && !chat.isPending && !chat.isError && (
        <Card padding="lg" className="text-center">
          <p className="text-sm text-content-secondary">No exchanges yet.</p>
          <p className="mt-1 text-sm text-content-muted">
            Send a prompt above — responses collect here, newest first.
          </p>
        </Card>
      )}

      {exchanges.map((exchange) => (
        <ResponseCard
          key={exchange.id}
          prompt={exchange.prompt}
          response={exchange.response}
        />
      ))}
    </section>
  )
}
