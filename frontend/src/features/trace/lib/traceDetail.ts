import { PROVIDERS, type Provider } from '@/types/enums'

/**
 * Readers for the `detail` bag on a `TraceEvent`.
 *
 * ⚠ CONTRACT GAP — Phase 2 types `detail` as `z.record(z.string(), z.unknown())`,
 * i.e. a free-form object with no documented keys. Nothing in the contract says
 * how a cache hit, a chosen provider or a skipped provider is spelled. The
 * canvas needs all three.
 *
 * Rather than invent keys inside the store or a component, every guess is
 * confined to this file, is tolerant of several plausible spellings, and
 * reports "don't know" as `null` instead of defaulting to something that looks
 * like real data. `api/schemas.ts` is deliberately left alone — narrowing the
 * contract is a backend conversation, not a frontend patch.
 *
 * When the real key names are confirmed, this file shrinks to one lookup each.
 */

/**
 * Keys checked for "which provider is this event about".
 *
 * `selected` and `provider` are the two the live backend actually uses
 * (`route` frames say `selected`, `call` frames say `provider`); the rest are
 * kept as tolerated spellings.
 */
export const PROVIDER_KEYS = [
  'provider',
  'provider_used',
  'selected',
  'to',
  'target',
  'selected_provider',
  'chosen_provider',
] as const

/** Keys checked for "which provider was walked away from". */
export const SKIPPED_PROVIDER_KEYS = [
  'from',
  'skipped',
  'skipped_provider',
  'previous_provider',
] as const

/** Keys checked for a boolean cache verdict. */
export const CACHE_HIT_BOOLEAN_KEYS = ['hit', 'cache_hit', 'cached', 'is_hit'] as const

/** Keys checked for a string cache verdict (`"hit"` / `"miss"`). */
export const CACHE_HIT_STRING_KEYS = ['status', 'result', 'outcome', 'cache'] as const

const HIT_WORDS = new Set(['hit', 'cached', 'cache_hit'])
const MISS_WORDS = new Set(['miss', 'missed', 'cache_miss', 'none'])

type Detail = Record<string, unknown>

function asProvider(value: unknown): Provider | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return (PROVIDERS as readonly string[]).includes(normalized)
    ? (normalized as Provider)
    : null
}

function firstProvider(detail: Detail, keys: readonly string[]): Provider | null {
  for (const key of keys) {
    const value = detail[key]

    // Some spellings are plural — `skipped: ["groq"]`, or the richer
    // `skipped: [{ provider, reason }]` shape the chat contract already uses.
    if (Array.isArray(value)) {
      for (const item of value) {
        const direct = asProvider(item)
        if (direct) return direct
        if (item && typeof item === 'object') {
          const nested = asProvider((item as Detail).provider)
          if (nested) return nested
        }
      }
      continue
    }

    const provider = asProvider(value)
    if (provider) return provider
  }
  return null
}

/** The provider an event targets, or `null` when no known key names one. */
export function readProvider(detail: Detail): Provider | null {
  return firstProvider(detail, PROVIDER_KEYS)
}

/** The provider a fallback event moved away from, or `null` if unstated. */
export function readSkippedProvider(detail: Detail): Provider | null {
  return firstProvider(detail, SKIPPED_PROVIDER_KEYS)
}

/**
 * Cache verdict for a `cache_check` event.
 *
 * Tri-state on purpose: `true` hit, `false` explicit miss, `null` undetermined.
 * The store treats `null` as "carry on down the normal path", so an
 * unrecognised payload degrades to the ordinary traversal rather than to a
 * ripple the backend never claimed.
 */
export function readCacheHit(detail: Detail): boolean | null {
  for (const key of CACHE_HIT_BOOLEAN_KEYS) {
    const value = detail[key]
    if (typeof value === 'boolean') return value
  }

  for (const key of CACHE_HIT_STRING_KEYS) {
    const value = detail[key]
    if (typeof value !== 'string') continue
    const normalized = value.trim().toLowerCase()
    if (HIT_WORDS.has(normalized)) return true
    if (MISS_WORDS.has(normalized)) return false
  }

  return null
}

/** Human-readable reason, when the event carries one. */
export function readReason(detail: Detail): string | null {
  for (const key of ['reason', 'cause', 'error', 'message']) {
    const value = detail[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return null
}
