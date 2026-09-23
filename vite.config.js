import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { configDefaults } from 'vitest/config';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],

  server: {
    port: 5173,
    host: true,
    hmr: { overlay: false },
    watch: {
      // A large reference file dropped at the project root
      // (caspira-crm-animated-background-only*.html) previously crashed the
      // dev server outright — Windows held the file locked and Vite's fs
      // watcher threw an unhandled EBUSY error trying to watch it. It isn't
      // part of the app (the actual background HTML lives in
      // public/backgrounds/, served as a static asset), so it never needs
      // to be watched at all.
      ignored: ["**/caspira-crm-animated-background-only*.html"],
    },
  },

  build: {
    sourcemap: true,
    minify: 'esbuild',
    chunkSizeWarningLimit: 1000,
  },

  test: {
    environment: 'jsdom',
    setupFiles: './src/setupTests.js',
    globals: true,
    // server/ is its own separate Node project with its own vitest version
    // and test env (see server/package.json) — without this it also
    // matches vitest's default *.test.js glob and gets swept into this
    // (jsdom, v4) run by mistake, which fails since it was written for and
    // verified against the backend's own (Node, v3) vitest install.
    exclude: [...configDefaults.exclude, 'server/**'],
    // Tests are written against the mock layer — pin every backend-mode
    // flag off so a developer's local .env (which may turn them on for
    // `npm run dev`) never changes what the suite exercises.
    env: {
      VITE_USE_MOCK_API: 'true',
      VITE_BACKEND_AUTH_MODE: 'false',
      VITE_BACKEND_CRM_MODE: 'false',
      VITE_BACKEND_SALES_MODE: 'false',
      VITE_BACKEND_CRM_SALES_MODE: 'false',
      VITE_BACKEND_SUPPORT_MODE: 'false',
    },
  }
});
