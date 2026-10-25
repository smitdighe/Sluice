import { TRACE_STAGES, type TraceStage } from '@/types/enums'

/**
 * ⚠ CONTRACT SHIM — the trace stream does not emit what `TraceEventSchema`
 * describes. Observed live (2026-07-29, `GET /v1/trace/stream`):
 *
 *   data: {"request_id": "39b5…", "stage": "classify",
 *          "classification": "simple", "reason": "no complex/bulk signal"}
 *   data: {"request_id": "39b5…", "stage": "cache", "result": "miss"}
 *
 * Three differences from the Phase 2 contract:
 *
 *   1. no `detail` object — the per-stage fields are flattened onto the frame;
 *   2. no `timestamp` field at all;
 *   3. `stage` is `"cache"`, but the enum (and the graph) say `"cache_check"`.
 *
 * Unadapted, every frame fails validation and the canvas stays empty forever.
 * So this maps the wire shape onto the contract instead of widening the
 * contract to match a backend that may still be corrected: `schemas.ts` is
 * untouched, and the day the stream emits the documented shape this function
 * becomes a no-op that can be deleted.
 *
 * `timestamp` is the one value invented here — the client's receipt time,
 * because the schema requires an ISO string and the wire gives none. It is
 * therefore a display-only approximation and is never used for ordering or
 * eviction (the store stamps its own `receivedAt` for that).
 *
 * The observed stage *order* is also not the documented one — the live stream
 * sends route before cache. That is left alone: the store's monotonic stage
 * rank already tolerates it, and reordering events here would hide a real
 * backend behaviour behind a frontend fiction.
 */

/** Wire spellings that do not match `TRACE_STAGES`. */
const STAGE_ALIASES: Record<string, TraceStage> = {
  cache: 'cache_check',
  cache_lookup: 'cache_check',
}

/** Keys that belong to the envelope; everything else is `detail`. */
const ENVELOPE_KEYS = new Set(['request_id', 'stage', 'timestamp', 'detail'])

const KNOWN_STAGES = new Set<string>(TRACE_STAGES)

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/**
 * Wire frame → `TraceEvent` shape. Returns the input untouched when it is not
 * an object, letting `TraceEventSchema` reject it with its own error.
 */
export function normalizeTraceFrame(raw: unknown, now: Date = new Date()): unknown {
  const frame = asRecord(raw)
  if (!frame) return raw

  const rawStage = frame.stage
  const stage =
    typeof rawStage === 'string' && !KNOWN_STAGES.has(rawStage)
      ? (STAGE_ALIASES[rawStage] ?? rawStage)
      : rawStage

  // Already contract-shaped: pass through, only fixing the stage spelling.
  const existingDetail = asRecord(frame.detail)
  if (existingDetail && typeof frame.timestamp === 'string') {
    return { ...frame, stage }
  }

  const detail: Record<string, unknown> = { ...existingDetail }
  for (const [key, value] of Object.entries(frame)) {
    if (ENVELOPE_KEYS.has(key)) continue
    detail[key] = value
  }

  return {
    request_id: frame.request_id,
    stage,
    detail,
    timestamp: typeof frame.timestamp === 'string' ? frame.timestamp : now.toISOString(),
  }
}
