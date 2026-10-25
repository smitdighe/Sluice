import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router-dom'

import { Button, Card } from '@/components/ui'

/**
 * Last-resort fallbacks for a *render* crash.
 *
 * Not to be confused with `components/feedback/QueryStates.tsx` — `ErrorState`
 * handles a request that failed, which is an expected outcome the UI is
 * designed around. This file handles a component that threw, which is a bug.
 * The two must not be merged: one offers "Retry", the other cannot promise
 * that retrying will do anything.
 *
 * Both boundaries come from React Router rather than a hand-rolled class
 * component, because the router already owns the one thing a hand-rolled
 * boundary gets wrong: resetting. A React error boundary stays broken until
 * something remounts it, so a user who navigates away from a crashed page
 * would keep seeing the crash. Router-level error elements are torn down on
 * the next navigation for free.
 *
 * Without these, React Router falls back to its own default error element,
 * which renders a raw stack trace — fine locally, wrong in front of a user.
 */

/** Normalise anything throwable into something printable. */
function describe(error: unknown): { title: string; detail: string | null } {
  if (isRouteErrorResponse(error)) {
    return {
      title: `${error.status} ${error.statusText}`,
      detail: typeof error.data === 'string' ? error.data : null,
    }
  }
  if (error instanceof Error) {
    return { title: error.name, detail: error.message }
  }
  if (typeof error === 'string') return { title: 'Error', detail: error }
  return { title: 'Error', detail: null }
}

/**
 * The stack is shown only in development.
 *
 * In production it is noise at best and an information leak at worst, and the
 * user cannot act on it either way — the browser console still has the full
 * trace for anyone who needs it.
 */
function StackDetail({ error }: { error: unknown }) {
  if (!import.meta.env.DEV) return null
  if (!(error instanceof Error) || !error.stack) return null

  return (
    <pre className="mt-4 max-h-48 overflow-auto rounded-control bg-surface-sunken p-3 text-left font-mono text-2xs leading-relaxed text-content-muted">
      {error.stack}
    </pre>
  )
}

/**
 * Crash inside a routed page. The shell — sidebar, health indicator, command
 * palette — is still mounted around this, so navigation still works and the
 * user is not stranded.
 */
export function RouteErrorPage() {
  const error = useRouteError()
  const navigate = useNavigate()
  const { title, detail } = describe(error)

  return (
    <section className="grid min-h-full place-items-center p-4 sm:p-6">
      <Card
        padding="lg"
        className="max-w-lg border-status-error-line bg-status-error-soft text-center"
      >
        <p className="font-mono text-2xs tracking-widest text-status-error uppercase">
          This view crashed
        </p>
        <h1 className="mt-2 font-mono text-lg text-content-primary">{title}</h1>
        {detail && (
          <p className="mt-2 text-sm break-words text-content-secondary">{detail}</p>
        )}
        <p className="mt-2 text-sm text-content-muted">
          The rest of the app is still running — pick another view from the sidebar, or
          reload to start clean.
        </p>

        <StackDetail error={error} />

        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <Button onClick={() => void navigate('/chat')}>Back to Chat</Button>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Reload page
          </Button>
        </div>
      </Card>
    </section>
  )
}

/**
 * Crash in `AppShell` itself, which means there is no shell left to render
 * into — no sidebar, no router-driven navigation to offer. A hard reload is
 * the only honest recovery, so this deliberately uses `href` rather than
 * `navigate`: client-side routing is exactly what is not working.
 */
export function AppCrashPage() {
  const error = useRouteError()
  const { title, detail } = describe(error)

  return (
    <div className="grid min-h-dvh place-items-center bg-surface-base p-4 sm:p-6">
      <Card padding="lg" className="max-w-lg text-center">
        <p className="font-mono text-2xs tracking-widest text-status-error uppercase">
          Sluice failed to start
        </p>
        <h1 className="mt-2 font-mono text-lg text-content-primary">{title}</h1>
        {detail && (
          <p className="mt-2 text-sm break-words text-content-secondary">{detail}</p>
        )}

        <StackDetail error={error} />

        <Button className="mt-5" onClick={() => window.location.assign('/chat')}>
          Reload Sluice
        </Button>
      </Card>
    </div>
  )
}
