import { useLocation, useNavigate } from 'react-router-dom'

import { Button, Card } from '@/components/ui'

export function NotFoundPage() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  return (
    <section className="grid min-h-full place-items-center p-4 sm:p-6">
      <Card padding="lg" className="max-w-md text-center">
        <p className="font-mono text-2xs tracking-widest text-content-faint uppercase">
          404
        </p>
        <h1 className="mt-2 font-mono text-lg text-content-primary">No such route</h1>
        <p className="mt-2 text-sm text-content-muted">
          Nothing is mounted at{' '}
          <span className="font-mono text-content-secondary">{pathname}</span>.
        </p>
        <Button className="mt-5" onClick={() => void navigate('/chat')}>
          Back to Chat
        </Button>
      </Card>
    </section>
  )
}
