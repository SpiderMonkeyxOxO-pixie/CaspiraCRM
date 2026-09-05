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
  }
});
