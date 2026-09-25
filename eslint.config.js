import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // server/ is its own separate Node project (see server/package.json) —
  // linting it with this config's browser globals produces false
  // 'process is not defined' errors; it has no lint setup of its own today.
  globalIgnores(['dist', 'server']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // `motion` (framer-motion) is only referenced as <motion.div>, which
      // this config's JSX handling doesn't count as a use.
      'no-unused-vars': ['error', { varsIgnorePattern: '^([A-Z_]|motion$)', argsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    // Build configuration runs in Node, not the browser.
    files: ['vite.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    // The Firebase messaging service worker runs in a worker scope with the
    // Firebase compat SDK loaded by importScripts().
    files: ['public/firebase-messaging-sw.js'],
    languageOptions: { globals: { ...globals.serviceworker, firebase: 'readonly' } },
  },
])
