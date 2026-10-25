import type { SVGProps } from 'react'

/**
 * Hand-rolled placeholder glyphs.
 *
 * `lucide-react` is not a dependency and Phase 3 said not to add an icon
 * library without asking, so these are four inline SVGs instead — swap them
 * for real icons whenever a library gets approved.
 */

type IconProps = SVGProps<SVGSVGElement>

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}

export function ChatIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />
    </Icon>
  )
}

export function TraceIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12h4l3-7 4 14 3-7h4" />
    </Icon>
  )
}

export function EvalIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 3v18h18" />
      <path d="M7 15v3M12 10v8M17 6v12" />
    </Icon>
  )
}

export function AdminIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 2 3 6v6c0 5 3.8 9.4 9 10 5.2-.6 9-5 9-10V6l-9-4Z" />
    </Icon>
  )
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Icon>
  )
}

export function MenuIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Icon>
  )
}
