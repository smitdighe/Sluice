import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge conditional class names, letting later Tailwind utilities win over
 * earlier conflicting ones. Every UI primitive takes a `className` override,
 * so this is what makes those overrides actually stick.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
