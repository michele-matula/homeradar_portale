import { defineConfig } from 'vitest/config';

// Il codice provato qui riceve le API del browser come dipendenze: niente plugin di WXT (che leggerebbe il manifest).
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['fake-indexeddb/auto'],
    include: ['tests/unit/**/*.test.ts'],
  },
});
