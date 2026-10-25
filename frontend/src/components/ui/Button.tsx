import type { ComponentPropsWithRef } from 'react'

import { cn } from '@/lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant
  size?: ButtonSize
}

const BASE =
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-control ' +
  'font-medium transition-colors duration-100 ease-out ' +
  'disabled:pointer-events-none disabled:opacity-45'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-content-inverse hover:bg-accent-hover active:brightness-95',
  secondary:
    'border border-surface-line bg-surface-inset text-content-primary ' +
    'hover:border-surface-line-strong hover:bg-surface-overlay',
  ghost: 'text-content-secondary hover:bg-surface-raised hover:text-content-primary',
  danger:
    'bg-status-error text-content-inverse hover:brightness-110 active:brightness-95',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
  lg: 'h-11 px-5 text-base',
  icon: 'h-9 w-9 p-0 text-sm',
}

export function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(BASE, VARIANTS[variant], SIZES[size], className)}
      {...props}
    />
  )
}
