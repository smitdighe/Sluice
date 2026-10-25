import { useState } from 'react'

import { Button, Card } from '@/components/ui'
import type { ChatRequest } from '@/features/chat/types'
import { cn } from '@/lib/cn'

export interface ChatComposerProps {
  onSubmit: (payload: ChatRequest) => void
  isPending: boolean
}

export function ChatComposer({ onSubmit, isPending }: ChatComposerProps) {
  const [prompt, setPrompt] = useState('')
  const [batchHint, setBatchHint] = useState(false)

  const trimmed = prompt.trim()
  const canSubmit = trimmed.length > 0 && !isPending

  function submit() {
    if (!canSubmit) return
    // Omit `metadata` entirely when the toggle is off — the contract has it
    // optional, and sending `{}` would imply a hint that wasn't given.
    onSubmit(
      batchHint
        ? { prompt: trimmed, metadata: { batch_hint: true } }
        : { prompt: trimmed },
    )
    setPrompt('')
  }

  return (
    <Card>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <label htmlFor="chat-prompt" className="sr-only">
          Prompt
        </label>
        <textarea
          id="chat-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            // ⌘/Ctrl+Enter submits; plain Enter keeps writing.
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              submit()
            }
          }}
          rows={4}
          placeholder="Ask the router something…"
          disabled={isPending}
          className={cn(
            'w-full resize-y rounded-control border border-surface-line bg-surface-inset',
            'px-3 py-2 text-sm text-content-primary placeholder:text-content-faint',
            'disabled:opacity-60',
          )}
        />

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-content-muted select-none">
            <input
              type="checkbox"
              checked={batchHint}
              onChange={(event) => setBatchHint(event.target.checked)}
              disabled={isPending}
              className="h-3.5 w-3.5 accent-accent"
            />
            <span className="font-mono">metadata.batch_hint</span>
          </label>

          <div className="flex-1" />

          <span className="font-mono text-2xs text-content-faint">⌘/Ctrl + ↵</span>
          <Button type="submit" disabled={!canSubmit}>
            {isPending ? 'Routing…' : 'Send'}
          </Button>
        </div>
      </form>
    </Card>
  )
}
