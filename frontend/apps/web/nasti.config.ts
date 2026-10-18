import { defineConfig } from '@nasti-toolchain/nasti';
import { tanstackRouter } from '@wuling/nasti-tanstack-router';
import { tanstackStart } from '@wuling/nasti-tanstack-start';

export default defineConfig({
  framework: 'react',
  server: { port: 3000 },
  plugins: [tanstackRouter(), tanstackStart()],
});
