import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      // @microsoft/applicationinsights-web v3.x ships individual ESM files
      // ('dist-es5/') with intra-package relative imports (e.g. "../DynamicConstants")
      // that Rollup cannot resolve during the Vite production build.
      // Aliasing to the self-contained UMD bundle ('dist/es5/') avoids the issue:
      // Rollup sees a single pre-built file with no unresolvable internal imports.
      '@microsoft/applicationinsights-web': fileURLToPath(
        new URL(
          'node_modules/@microsoft/applicationinsights-web/dist/es5/applicationinsights-web.js',
          import.meta.url,
        )
      ),
    },
  },

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
