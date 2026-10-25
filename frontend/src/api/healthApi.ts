import { apiGet } from '@/api/client'
import { HealthSchema, type Health } from '@/api/schemas'

/** `GET /v1/health` — liveness only; says nothing about providers. */
export function getHealth(signal?: AbortSignal): Promise<Health> {
  return apiGet('/v1/health', HealthSchema, { signal })
}
