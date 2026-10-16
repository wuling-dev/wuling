import { defineConfig } from '@nasti-toolchain/nasti'
import { tanstackStart } from './packages/nasti-tanstack-start/index.ts'

export default defineConfig({
  framework: 'react',
  server: { port: 3000 },
  plugins: [tanstackStart()],
})
