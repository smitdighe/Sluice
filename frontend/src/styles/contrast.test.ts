import { describe, expect, it } from 'vitest'

import tailwindConfig from '../../tailwind.config'

/**
 * WCAG AA guard for the Phase 1 colour tokens.
 *
 * The design is dark-mode-only, which makes it very easy to pick a "muted"
 * grey that looks right and fails contrast — this file is what stops that
 * being discovered by a user instead of by CI.
 *
 * Two thresholds apply:
 *   - 4.5:1 for anything that renders text (the whole content ramp, every
 *     status token, the accent);
 *   - 3:1 for non-text UI that still has to be perceivable, which here means
 *     the canvas node strokes drawn on `surface.sunken`.
 *
 * Backgrounds are enumerated rather than assumed: `surface.inset` is the
 * lightest surface in the system, so it — not the page background — is what
 * binds the ramp.
 */

/* ── Colour maths (WCAG 2.1 relative luminance) ──────────────────── */

interface Rgb {
  r: number
  g: number
  b: number
}

function parseHex(hex: string): Rgb {
  const value = hex.replace('#', '')
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  }
}

/** `rgba(r, g, b, a)` — the shape every `soft`/`line` token uses. */
function parseRgba(value: string): { rgb: Rgb; alpha: number } {
  const match =
    /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)/.exec(value)
  if (!match) throw new Error(`Not an rgb(a) colour: ${value}`)

  return {
    rgb: { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) },
    alpha: match[4] === undefined ? 1 : Number(match[4]),
  }
}

/** Flatten a translucent colour onto an opaque one — what the eye actually sees. */
function composite(top: Rgb, alpha: number, bottom: Rgb): Rgb {
  return {
    r: top.r * alpha + bottom.r * (1 - alpha),
    g: top.g * alpha + bottom.g * (1 - alpha),
    b: top.b * alpha + bottom.b * (1 - alpha),
  }
}

function channelLuminance(channel: number): number {
  const srgb = channel / 255
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
}

function luminance({ r, g, b }: Rgb): number {
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  )
}

export function contrastRatio(foreground: Rgb, background: Rgb): number {
  const a = luminance(foreground)
  const b = luminance(background)
  const [lighter, darker] = a > b ? [a, b] : [b, a]
  return (lighter + 0.05) / (darker + 0.05)
}

/* ── Token access ────────────────────────────────────────────────── */

/* The config is typed loosely by Tailwind; this file is the only place that
   reaches into it, so the cast is contained here rather than exported. */
const colors = tailwindConfig.theme?.extend?.colors as unknown as {
  surface: Record<string, string>
  content: Record<string, string>
  accent: { DEFAULT: string; hover: string; soft: string; line: string }
  status: Record<string, { DEFAULT: string; soft: string; line: string; glow: string }>
}

/** Every opaque background a token is ever painted on. */
const SURFACES = ['sunken', 'base', 'raised', 'overlay', 'inset'] as const

const CONTENT_TEXT_TOKENS = ['primary', 'secondary', 'muted', 'faint'] as const

/**
 * `half-open` is a kebab alias of `half_open` with identical values, so it is
 * skipped rather than asserted twice.
 */
const STATUS_TOKENS = Object.keys(colors.status).filter((key) => key !== 'half-open')

const AA_TEXT = 4.5
const AA_NON_TEXT = 3

function ratioOn(foregroundHex: string, surface: (typeof SURFACES)[number]): number {
  return contrastRatio(parseHex(foregroundHex), parseHex(colors.surface[surface]))
}

/* ── Assertions ──────────────────────────────────────────────────── */

describe('content ramp', () => {
  for (const token of CONTENT_TEXT_TOKENS) {
    for (const surface of SURFACES) {
      it(`content.${token} clears AA on surface.${surface}`, () => {
        expect(ratioOn(colors.content[token], surface)).toBeGreaterThanOrEqual(AA_TEXT)
      })
    }
  }

  it('stays monotonic — each step is dimmer than the one above it', () => {
    const ratios = CONTENT_TEXT_TOKENS.map((token) =>
      ratioOn(colors.content[token], 'raised'),
    )

    for (let index = 1; index < ratios.length; index += 1) {
      expect(ratios[index]).toBeLessThan(ratios[index - 1])
    }
  })

  it('content.inverse is legible on a filled accent, which is its only use', () => {
    const ratio = contrastRatio(
      parseHex(colors.content.inverse),
      parseHex(colors.accent.DEFAULT),
    )
    expect(ratio).toBeGreaterThanOrEqual(AA_TEXT)
  })
})

describe('status tokens as text', () => {
  for (const token of STATUS_TOKENS) {
    it(`status.${token} clears AA on surface.raised, the card background`, () => {
      expect(ratioOn(colors.status[token].DEFAULT, 'raised')).toBeGreaterThanOrEqual(
        AA_TEXT,
      )
    })

    /* A Badge paints its own translucent wash over the card, which lightens
       the background it is read against — the badge, not the bare card, is
       the real worst case for these tokens. */
    it(`status.${token} clears AA against its own soft wash (Badge)`, () => {
      const { rgb, alpha } = parseRgba(colors.status[token].soft)
      const background = composite(rgb, alpha, parseHex(colors.surface.raised))

      expect(
        contrastRatio(parseHex(colors.status[token].DEFAULT), background),
      ).toBeGreaterThanOrEqual(AA_TEXT)
    })
  }
})

describe('accent', () => {
  it('clears AA as text on every surface', () => {
    for (const surface of SURFACES) {
      expect(ratioOn(colors.accent.DEFAULT, surface)).toBeGreaterThanOrEqual(AA_TEXT)
    }
  })

  it('accent.hover is never dimmer than accent — hover must not lose contrast', () => {
    expect(ratioOn(colors.accent.hover, 'raised')).toBeGreaterThanOrEqual(
      ratioOn(colors.accent.DEFAULT, 'raised'),
    )
  })
})

describe('canvas graphics on surface.sunken', () => {
  /* The circuit canvas sits in a `surface.sunken` well. Node strokes and
     packets are meaningful graphics, not decoration, so they owe 3:1. */
  it('every circuit-state tone is perceivable', () => {
    for (const token of STATUS_TOKENS) {
      expect(ratioOn(colors.status[token].DEFAULT, 'sunken')).toBeGreaterThanOrEqual(
        AA_NON_TEXT,
      )
    }
  })

  it('the idle node tone is perceivable', () => {
    /* Idle stage nodes are drawn in `content.faint`. They used to use
       `surface.line-strong`, which measured 1.8:1 — invisible in the well. */
    expect(ratioOn(colors.content.faint, 'sunken')).toBeGreaterThanOrEqual(AA_NON_TEXT)
    expect(ratioOn(colors.surface['line-strong'], 'sunken')).toBeLessThan(AA_NON_TEXT)
  })

  it('the in-flight packet tone is perceivable', () => {
    expect(ratioOn(colors.accent.DEFAULT, 'sunken')).toBeGreaterThanOrEqual(AA_NON_TEXT)
  })
})
