import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify('test') },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
    // Più ampio delle attese di Testing Library (4 s in test/setup.ts): un test lento fallisce sull'attesa, con il suo messaggio.
    testTimeout: 10_000,
  },
});
