import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,

    // Proxy /api requests to the Azure Functions local runtime.
    // This mirrors the routing that SWA CLI provides in integration mode,
    // so fetch('/api/health') works in both local-only and SWA-CLI modes.
    proxy: {
      '/api': {
        target: 'http://localhost:7071',
        changeOrigin: true,
        // No path rewrite – Functions already serve under /api/<route>
      },
    },
  },
});
