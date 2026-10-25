import type { ComponentType, SVGProps } from 'react'

import { AdminIcon, ChatIcon, EvalIcon, TraceIcon } from '@/app/layout/NavIcons'

/**
 * The one list of primary destinations.
 *
 * Sidebar and command palette both read from here, so a route can never be
 * navigable from one and missing from the other.
 */
export interface NavItem {
  /** Route path, matching `router.tsx`. */
  to: string
  /** Sidebar label and palette search target. */
  label: string
  /** Extra words the palette should match on. */
  keywords: string[]
  icon: ComponentType<SVGProps<SVGSVGElement>>
}

export const NAV_ITEMS: NavItem[] = [
  {
    to: '/chat',
    label: 'Chat',
    keywords: ['playground', 'prompt', 'ask'],
    icon: ChatIcon,
  },
  {
    to: '/trace',
    label: 'Trace',
    keywords: ['stream', 'pipeline', 'live', 'events'],
    icon: TraceIcon,
  },
  {
    to: '/eval',
    label: 'Eval',
    keywords: ['runs', 'scores', 'benchmark'],
    icon: EvalIcon,
  },
  {
    to: '/admin',
    label: 'Admin',
    keywords: ['quota', 'providers', 'cache', 'circuit'],
    icon: AdminIcon,
  },
]
