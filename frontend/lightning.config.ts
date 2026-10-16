import { defineConfig } from '@lightning-js/lightning/config'
import { fileURLToPath } from 'node:url'
// Give the test module runner its own root, without the app's SSR build environment.
export default defineConfig({ root: fileURLToPath(new URL('./tests', import.meta.url)), test: { include: ['**/*.test.ts'], environment: 'node', maxWorkers: 1 } })
