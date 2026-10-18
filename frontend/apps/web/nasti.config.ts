import { defineConfig } from '@nasti-toolchain/nasti';
import { tanstackStart } from '@wuling/nasti-tanstack-start';

export default defineConfig({
  framework: 'react',
  server: { port: 3000 },
  plugins: [tanstackStart()],
});
