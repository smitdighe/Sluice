import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:8008'

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      /**
       * The backend serves no `Access-Control-Allow-Origin`, so a direct
       * browser call from the dev origin is blocked. Proxying `/v1` through
       * Vite makes it same-origin instead — no backend change required.
       *
       * `VITE_API_BASE_URL` therefore points at the dev server in development.
       * In production, point it at the real origin (which will need proper
       * CORS, or its own reverse proxy).
       */
      proxy: {
        '/v1': {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
