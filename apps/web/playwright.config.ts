import { defineConfig } from '@playwright/test';

// Si lancia con `npm run test:e2e` (scripts/e2e.mjs prepara SPA e D1 locale in .e2e-state).
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  workers: 1,
  use: { baseURL: 'http://localhost:8788', trace: 'retain-on-failure' },
  webServer: {
    command: 'npx wrangler dev --port 8788 --persist-to ../web/.e2e-state',
    cwd: '../server',
    url: 'http://localhost:8788',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
