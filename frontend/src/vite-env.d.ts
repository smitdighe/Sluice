/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the Sluice backend, no trailing slash. e.g. http://localhost:8000 */
  readonly VITE_API_BASE_URL?: string
  /** Optional. Sent as `X-API-Key` when non-empty; dev backends may not require it. */
  readonly VITE_API_KEY?: string
  /** Base delay for SSE reconnect backoff, in milliseconds. */
  readonly VITE_SSE_RECONNECT_MS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
