import type { Config } from 'tailwindcss'

/**
 * Sluice design tokens — dark-mode-first, infra/terminal aesthetic.
 *
 * Naming rule: feature code should never reach for a raw palette step
 * (`bg-green-500`). It references intent instead — `bg-status-closed`,
 * `text-content-muted`, `border-surface-line`.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /* ── Base surfaces: near-black, never pure #000 ───────────── */
        surface: {
          sunken: '#070809', // deepest well — page gutters, code wells
          base: '#0c0e11', // app background
          raised: '#121519', // cards, panels
          overlay: '#171b21', // popovers, tooltips, menus
          inset: '#1d222a', // inputs, inner wells
          line: '#242a33', // default hairline border
          'line-strong': '#333b47', // emphasized border, dividers
        },

        /* ── Foreground ramp ─────────────────────────────────────────
         * Every step carries real text somewhere in the app — `faint` is
         * not decorative, it labels stat tiles and table headers — so all
         * four clear WCAG AA (4.5:1) against the *lightest* background they
         * are ever painted on. That is `surface.inset` (#1d222a), not the
         * page background, which is why `muted` and `faint` sit higher than
         * a dark theme's instinct suggests.
         *
         * Measured ratios are asserted in `src/styles/contrast.test.ts`;
         * changing a value here without re-running that test is how this
         * silently regresses.
         */
        content: {
          primary: '#e7ebf0', // headings, high-emphasis copy
          secondary: '#a8b2c1', // body copy
          muted: '#94a0b2', // labels, captions, placeholders
          faint: '#828e9f', // stat labels, table headers, timestamps
          inverse: '#0c0e11', // text on a filled accent
        },

        /* ── Brand accent ────────────────────────────────────────── */
        accent: {
          DEFAULT: '#5aa9ff',
          hover: '#7bbcff',
          soft: 'rgba(90, 169, 255, 0.12)',
          line: 'rgba(90, 169, 255, 0.32)',
        },

        /* ── Semantic status tokens ──────────────────────────────
         * Circuit states + transport outcomes. Each exposes:
         *   DEFAULT → solid fill / text
         *   soft    → translucent background wash
         *   line    → translucent border / ring
         *   glow    → shadow colour for status pulses
         */
        status: {
          closed: {
            DEFAULT: '#3ecf8e',
            soft: 'rgba(62, 207, 142, 0.12)',
            line: 'rgba(62, 207, 142, 0.32)',
            glow: 'rgba(62, 207, 142, 0.45)',
          },
          open: {
            DEFAULT: '#ff5d5d',
            soft: 'rgba(255, 93, 93, 0.12)',
            line: 'rgba(255, 93, 93, 0.32)',
            glow: 'rgba(255, 93, 93, 0.45)',
          },
          half_open: {
            DEFAULT: '#f0a92c',
            soft: 'rgba(240, 169, 44, 0.12)',
            line: 'rgba(240, 169, 44, 0.32)',
            glow: 'rgba(240, 169, 44, 0.45)',
          },
          /* kebab alias so both `bg-status-half_open` and
             `bg-status-half-open` resolve — callers differ. */
          'half-open': {
            DEFAULT: '#f0a92c',
            soft: 'rgba(240, 169, 44, 0.12)',
            line: 'rgba(240, 169, 44, 0.32)',
            glow: 'rgba(240, 169, 44, 0.45)',
          },
          cached: {
            DEFAULT: '#8b7dff',
            soft: 'rgba(139, 125, 255, 0.12)',
            line: 'rgba(139, 125, 255, 0.32)',
            glow: 'rgba(139, 125, 255, 0.45)',
          },
          success: {
            DEFAULT: '#42d392',
            soft: 'rgba(66, 211, 146, 0.12)',
            line: 'rgba(66, 211, 146, 0.32)',
            glow: 'rgba(66, 211, 146, 0.45)',
          },
          error: {
            DEFAULT: '#f45b5b',
            soft: 'rgba(244, 91, 91, 0.12)',
            line: 'rgba(244, 91, 91, 0.32)',
            glow: 'rgba(244, 91, 91, 0.45)',
          },
          neutral: {
            DEFAULT: '#8b96a6',
            soft: 'rgba(139, 150, 166, 0.10)',
            line: 'rgba(139, 150, 166, 0.28)',
            glow: 'rgba(139, 150, 166, 0.40)',
          },
        },
      },

      fontFamily: {
        /* UI copy */
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        /* Numerics, IDs, keys, latencies — anything that should align */
        mono: [
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'Liberation Mono',
          'Courier New',
          'monospace',
        ],
      },

      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.02em' }],
      },

      borderRadius: {
        card: '0.75rem',
        control: '0.5rem',
      },

      boxShadow: {
        card: '0 1px 2px rgba(0, 0, 0, 0.5), 0 8px 24px -12px rgba(0, 0, 0, 0.7)',
        overlay: '0 12px 40px -8px rgba(0, 0, 0, 0.8)',
        'glow-sm': '0 0 0 1px currentColor, 0 0 12px -2px currentColor',
      },

      keyframes: {
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },

      animation: {
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
}

export default config
