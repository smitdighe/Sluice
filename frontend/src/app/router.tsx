import { createBrowserRouter, Navigate } from 'react-router-dom'

import { AppShell } from '@/app/layout/AppShell'
import { AppCrashPage, RouteErrorPage } from '@/app/pages/ErrorPage'
import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { AdminPage } from '@/features/admin/AdminPage'
import { ChatPage } from '@/features/chat/ChatPage'
import { EvalDetailPage } from '@/features/eval/EvalDetailPage'
import { EvalListPage } from '@/features/eval/EvalListPage'
import { TracePage } from '@/features/trace/TracePage'

/**
 * Every route is a child of `AppShell`, including the 404 — an unknown URL
 * still leaves the user with working navigation instead of a bare page.
 *
 * Error handling is deliberately two-tiered:
 *
 *   - the pathless layout route catches a crash in any *page*, and renders the
 *     fallback into the shell's outlet, so the sidebar and command palette
 *     survive and the user can navigate out of it;
 *   - the root route's `errorElement` is the tier below that, for when
 *     `AppShell` itself is what threw and there is no shell to render into.
 *
 * The pathless route exists purely to attach one `errorElement` to every page
 * at once, rather than repeating it on all six.
 */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    errorElement: <AppCrashPage />,
    children: [
      {
        errorElement: <RouteErrorPage />,
        children: [
          { index: true, element: <Navigate to="/chat" replace /> },
          { path: 'chat', element: <ChatPage /> },
          { path: 'trace', element: <TracePage /> },
          { path: 'eval', element: <EvalListPage /> },
          { path: 'eval/:runId', element: <EvalDetailPage /> },
          { path: 'admin', element: <AdminPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
])
