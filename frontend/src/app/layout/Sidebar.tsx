import { useEffect, useRef } from 'react'
import { NavLink } from 'react-router-dom'

import { NAV_ITEMS } from '@/app/navigation'
import { cn } from '@/lib/cn'

export interface SidebarProps {
  collapsed: boolean
  /** Called when a nav item is picked — lets the shell close the mobile drawer. */
  onNavigate?: () => void
  /** Move focus to the first destination on mount. Used by the mobile drawer. */
  autoFocus?: boolean
  id?: string
  className?: string
}

export function Sidebar({
  collapsed,
  onNavigate,
  autoFocus = false,
  id,
  className,
}: SidebarProps) {
  const firstLinkRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    if (autoFocus) firstLinkRef.current?.focus()
  }, [autoFocus])

  return (
    <nav
      id={id}
      aria-label="Primary"
      className={cn(
        'flex h-full flex-col gap-1 border-r border-surface-line bg-surface-raised p-2',
        collapsed ? 'w-16' : 'w-56',
        className,
      )}
    >
      {NAV_ITEMS.map((item, index) => {
        const Icon = item.icon

        return (
          <NavLink
            key={item.to}
            ref={index === 0 ? firstLinkRef : undefined}
            to={item.to}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              cn(
                'relative flex items-center gap-3 rounded-control px-3 py-2 text-sm',
                'transition-colors duration-100 ease-out',
                collapsed && 'justify-center px-0',
                isActive
                  ? 'bg-accent-soft text-content-primary'
                  : 'text-content-muted hover:bg-surface-overlay hover:text-content-secondary',
              )
            }
          >
            {({ isActive }) => (
              <>
                {/* Active rail — the highlight that reads at a glance. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute left-0 h-5 w-0.5 rounded-full bg-accent transition-opacity',
                    isActive ? 'opacity-100' : 'opacity-0',
                  )}
                />
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {/* Kept in the tree when collapsed rather than removed: the
                    label is the link's accessible name, and a `title` alone
                    leaves the link nameless to a screen reader. */}
                <span className={cn('truncate', collapsed && 'sr-only')}>
                  {item.label}
                </span>
              </>
            )}
          </NavLink>
        )
      })}
    </nav>
  )
}
