import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from 'axios'
import type { ZodType } from 'zod'

import { ApiErrorSchema } from '@/api/schemas'
import type { ApiError, ApiErrorBody } from '@/types/shared.types'

/* ── Environment ─────────────────────────────────────────────────── */

/**
 * Vite replaces `import.meta.env` at build time; Node scripts and tests have
 * no such object. Reading through this helper lets the same module run in
 * both without a second code path.
 */
function readEnv(key: string): string | undefined {
  const viteEnv = (import.meta as { env?: Record<string, string | undefined> }).env
  const fromVite = viteEnv?.[key]
  if (fromVite !== undefined && fromVite !== '') return fromVite

  // Reached via globalThis so the browser build needs no Node type definitions.
  const nodeEnv = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env
  const fromNode = nodeEnv?.[key]
  return fromNode !== undefined && fromNode !== '' ? fromNode : undefined
}

/** Backend origin, no trailing slash — route paths already begin with `/v1`. */
export const API_BASE_URL = (
  readEnv('VITE_API_BASE_URL') ?? 'http://localhost:8000'
).replace(/\/+$/, '')

/**
 * Optional. Absent is a supported state, not an error — the dev backend may
 * not enforce auth yet, so an empty key simply means no header is sent.
 */
export const API_KEY = readEnv('VITE_API_KEY') ?? ''

/** Default ceiling for ordinary requests. */
export const DEFAULT_TIMEOUT_MS = 15_000

/** Chat hits an upstream LLM and legitimately runs long. Override per call. */
export const CHAT_TIMEOUT_MS = 120_000

/** Base delay for the trace-stream reconnect backoff. */
export const SSE_RECONNECT_BASE_MS = Number(readEnv('VITE_SSE_RECONNECT_MS') ?? 2000)

/* ── Typed error ─────────────────────────────────────────────────── */

/** Every failure this layer raises is one of these. */
export type ApiErrorKind =
  | 'invalid_response' // 2xx body did not match its schema
  | 'network_error' // request never reached the backend
  | 'timeout'
  | 'canceled'
  | 'http_error' // non-2xx without the documented error envelope
  | (string & {}) // anything the backend puts in `error.type`

/**
 * The single throw type of this layer.
 *
 * Callers never inspect a response for both a success shape and an error
 * shape: a resolved promise is always validated data, and a rejection is
 * always an `ApiClientError`.
 */
export class ApiClientError extends Error {
  readonly type: ApiErrorKind
  readonly detail: Record<string, unknown>
  /** HTTP status, when the failure got that far. */
  readonly status?: number
  /** Original throwable, for logging. Never rendered. */
  readonly cause?: unknown

  constructor(params: {
    type: ApiErrorKind
    message: string
    detail?: Record<string, unknown>
    status?: number
    cause?: unknown
  }) {
    super(params.message)
    this.name = 'ApiClientError'
    this.type = params.type
    this.detail = params.detail ?? {}
    this.status = params.status
    this.cause = params.cause
  }

  /** Re-serialise into the backend's wire shape. */
  toApiError(): ApiError {
    return { error: { type: this.type, message: this.message, detail: this.detail } }
  }
}

export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError
}

/** Narrow an unknown body to the documented `{ error: {...} }` envelope. */
function asErrorEnvelope(body: unknown): ApiErrorBody | null {
  const parsed = ApiErrorSchema.safeParse(body)
  return parsed.success ? parsed.data.error : null
}

/* ── Instance ────────────────────────────────────────────────────── */

export const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: DEFAULT_TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' },
})

apiClient.interceptors.request.use((config) => {
  if (API_KEY) {
    config.headers.set('X-API-Key', API_KEY)
  }
  return config
})

/**
 * Normalises every outcome into "validated data" or `ApiClientError`.
 *
 * Schema validation lives in `parseWith` rather than here: an interceptor
 * sees only a URL, so it cannot know which schema applies. What it *can* do
 * unambiguously is recognise the error envelope — including the case where a
 * backend returns one under a 2xx — and collapse transport failures into the
 * same error type.
 */
apiClient.interceptors.response.use(
  (response: AxiosResponse) => {
    const envelope = asErrorEnvelope(response.data)
    if (envelope) {
      throw new ApiClientError({
        type: envelope.type,
        message: envelope.message,
        detail: envelope.detail,
        status: response.status,
      })
    }
    return response
  },
  (error: unknown) => {
    if (isApiClientError(error)) throw error

    if (error instanceof AxiosError) {
      const status = error.response?.status

      const envelope = asErrorEnvelope(error.response?.data)
      if (envelope) {
        throw new ApiClientError({
          type: envelope.type,
          message: envelope.message,
          detail: envelope.detail,
          status,
          cause: error,
        })
      }

      if (error.code === AxiosError.ECONNABORTED || error.code === AxiosError.ETIMEDOUT) {
        throw new ApiClientError({
          type: 'timeout',
          message: `Request to ${error.config?.url ?? 'the backend'} timed out.`,
          detail: { timeout_ms: error.config?.timeout },
          cause: error,
        })
      }

      if (axios.isCancel(error)) {
        throw new ApiClientError({
          type: 'canceled',
          message: 'Request was canceled.',
          cause: error,
        })
      }

      if (status === undefined) {
        throw new ApiClientError({
          type: 'network_error',
          message: `Could not reach the backend at ${API_BASE_URL}.`,
          detail: { code: error.code },
          cause: error,
        })
      }

      throw new ApiClientError({
        type: 'http_error',
        message: `HTTP ${status} from ${error.config?.url ?? 'the backend'}.`,
        detail: { status, body: error.response?.data },
        status,
        cause: error,
      })
    }

    throw new ApiClientError({
      type: 'network_error',
      message: error instanceof Error ? error.message : 'Unknown request failure.',
      cause: error,
    })
  },
)

/* ── Schema-checked helpers ──────────────────────────────────────── */

/** Validate a payload, converting a mismatch into `ApiClientError`. */
export function parseWith<T>(schema: ZodType<T>, data: unknown, source: string): T {
  const result = schema.safeParse(data)
  if (result.success) return result.data

  throw new ApiClientError({
    type: 'invalid_response',
    message: `Response from ${source} did not match the expected shape.`,
    detail: { issues: result.error.issues },
  })
}

export async function apiGet<T>(
  url: string,
  schema: ZodType<T>,
  config?: AxiosRequestConfig,
): Promise<T> {
  const response = await apiClient.get<unknown>(url, config)
  return parseWith(schema, response.data, `GET ${url}`)
}

export async function apiPost<T>(
  url: string,
  body: unknown,
  schema: ZodType<T>,
  config?: AxiosRequestConfig,
): Promise<T> {
  const response = await apiClient.post<unknown>(url, body, config)
  return parseWith(schema, response.data, `POST ${url}`)
}
