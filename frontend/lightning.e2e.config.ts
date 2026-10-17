import { defineConfig } from '@lightning-js/lightning/config'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  root: fileURLToPath(new URL('./e2e', import.meta.url)),
  test: { include: ['**/*.e2e.ts'], environment: 'node', maxWorkers: 1, testTimeout: 120000 },
})
