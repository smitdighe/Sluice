import type { Transition, Variants } from 'framer-motion'

/**
 * Shared motion vocabulary.
 *
 * Values only — no components. Later phases import from here instead of
 * inventing one-off durations and easings at the call site, so the whole
 * app accelerates and decelerates the same way.
 */

/* ── Durations ────────────────────────────────────────────────────
 * Milliseconds are the source of truth; they are also what CSS,
 * timeouts and tests speak. Framer wants seconds, hence `toSeconds`.
 */
export const FAST_MS = 120 // hovers, presses, tooltips
export const BASE_MS = 220 // cards entering, panels, most transitions
export const SLOW_MS = 380 // route/page level, large surfaces
export const STAGGER_MS = 40 // per-child offset in a list
export const PULSE_MS = 1600 // one full status-glow cycle

export const toSeconds = (milliseconds: number): number => milliseconds / 1000

export const FAST_S = toSeconds(FAST_MS)
export const BASE_S = toSeconds(BASE_MS)
export const SLOW_S = toSeconds(SLOW_MS)
export const STAGGER_S = toSeconds(STAGGER_MS)
export const PULSE_S = toSeconds(PULSE_MS)

/* ── Easing curves ───────────────────────────────────────────────── */
type Bezier = [number, number, number, number]

/** Default for anything that starts and ends on screen. */
export const EASE_STANDARD: Bezier = [0.4, 0, 0.2, 1]
/** Entering: fast start, gentle settle. */
export const EASE_OUT: Bezier = [0, 0, 0.2, 1]
/** Leaving: gentle start, quick exit. */
export const EASE_IN: Bezier = [0.4, 0, 1, 1]
/** Emphasized — reserve for large or celebratory movement. */
export const EASE_EMPHASIZED: Bezier = [0.2, 0, 0, 1]

/* ── Ready-made transitions ──────────────────────────────────────── */
export const transitionFast: Transition = { duration: FAST_S, ease: EASE_STANDARD }
export const transitionBase: Transition = { duration: BASE_S, ease: EASE_OUT }
export const transitionSlow: Transition = { duration: SLOW_S, ease: EASE_EMPHASIZED }
export const transitionExit: Transition = { duration: FAST_S, ease: EASE_IN }

/* ── Variants ────────────────────────────────────────────────────── */

/** Opacity only. Safest default when layout must not shift. */
export const fadeVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: transitionBase },
  exit: { opacity: 0, transition: transitionExit },
}

/** Cards and panels: fade up with a hair of scale. */
export const cardVariants: Variants = {
  hidden: { opacity: 0, y: 8, scale: 0.99 },
  visible: { opacity: 1, y: 0, scale: 1, transition: transitionBase },
  exit: { opacity: 0, y: -4, scale: 0.99, transition: transitionExit },
}

export const slideInLeftVariants: Variants = {
  hidden: { opacity: 0, x: -12 },
  visible: { opacity: 1, x: 0, transition: transitionBase },
  exit: { opacity: 0, x: -8, transition: transitionExit },
}

export const slideInRightVariants: Variants = {
  hidden: { opacity: 0, x: 12 },
  visible: { opacity: 1, x: 0, transition: transitionBase },
  exit: { opacity: 0, x: 8, transition: transitionExit },
}

export const slideInUpVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: transitionBase },
  exit: { opacity: 0, y: 8, transition: transitionExit },
}

/** Parent of a staggered list. Pair with `listItemVariants`. */
export const listVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: STAGGER_S, delayChildren: STAGGER_S },
  },
  exit: {
    opacity: 0,
    transition: { staggerChildren: STAGGER_S / 2, staggerDirection: -1 },
  },
}

export const listItemVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: transitionBase },
  exit: { opacity: 0, y: -4, transition: transitionExit },
}

/** Overlays: tooltips, popovers, menus. */
export const overlayVariants: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: transitionFast },
  exit: { opacity: 0, scale: 0.98, transition: transitionExit },
}

/**
 * Looping breath for status glows — a circuit sitting `open`, a live
 * connection indicator. `idle` is the parked state so a component can
 * flip between them without swapping variant objects.
 */
export const pulseVariants: Variants = {
  idle: { opacity: 1, scale: 1 },
  pulse: {
    opacity: [1, 0.55, 1],
    scale: [1, 1.06, 1],
    transition: {
      duration: PULSE_S,
      ease: 'easeInOut',
      repeat: Infinity,
      repeatType: 'loop',
    },
  },
}

/* ── Reduced motion ──────────────────────────────────────────────── */

/** Every named state resolves to "already there". */
export const staticVariants: Variants = {
  hidden: { opacity: 1 },
  visible: { opacity: 1 },
  exit: { opacity: 1 },
  idle: { opacity: 1 },
  pulse: { opacity: 1 },
}

/**
 * Swap any variant set for its motionless equivalent.
 * Usage: `variants={resolveVariants(cardVariants, useReducedMotion())}`
 */
export function resolveVariants(
  variants: Variants,
  prefersReducedMotion: boolean,
): Variants {
  return prefersReducedMotion ? staticVariants : variants
}
