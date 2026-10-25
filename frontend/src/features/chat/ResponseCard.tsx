import { Badge, Card, Stat } from '@/components/ui'
import type { BadgeStatus } from '@/components/ui'
import type { ChatResponse } from '@/features/chat/types'

export interface ResponseCardProps {
  /** The prompt that produced this response, echoed for context. */
  prompt: string
  response: ChatResponse
}

/** `ChatStatus` and `BadgeStatus` overlap exactly for these three values. */
const STATUS_BADGE: Record<ChatResponse['status'], BadgeStatus> = {
  success: 'success',
  cached: 'cached',
  error: 'error',
}

export function ResponseCard({ prompt, response }: ResponseCardProps) {
  const skipped = response.fallback_info?.skipped ?? []

  return (
    <Card>
      <p className="font-mono text-2xs tracking-widest text-content-faint uppercase">
        Prompt
      </p>
      <p className="mt-1 text-sm break-words whitespace-pre-wrap text-content-muted">
        {prompt}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Badge status={STATUS_BADGE[response.status]} dot>
          {response.status}
        </Badge>
        <Badge status="neutral">{response.provider_used}</Badge>
        <Badge status="neutral">{response.classification}</Badge>
      </div>

      <p className="mt-4 text-sm break-words whitespace-pre-wrap text-content-primary">
        {response.response}
      </p>

      {/* Two columns at 375px, three from `sm`. `request id` is a long mono
          string; `Stat` truncates it rather than letting it blow the grid out
          and force the card to scroll sideways. */}
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-surface-line pt-4 sm:grid-cols-3">
        <Stat label="latency" value={`${response.latency_ms} ms`} />
        <Stat label="provider" value={response.provider_used} />
        <Stat
          label="request id"
          value={response.request_id}
          className="col-span-2 sm:col-span-1"
        />
      </div>

      {/* Rendered only when the router actually skipped something — a null
          fallback_info must not leave an empty section behind. */}
      {skipped.length > 0 && (
        <div className="mt-4 border-t border-surface-line pt-4">
          <p className="font-mono text-2xs tracking-wide text-content-faint uppercase">
            Skipped providers
          </p>
          <ul className="mt-2 space-y-1">
            {skipped.map((entry, index) => (
              <li
                key={`${entry.provider}-${index}`}
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                <Badge status="half_open">{entry.provider}</Badge>
                <span className="text-content-muted">{entry.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}
