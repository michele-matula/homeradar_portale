declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ASSETS: Fetcher;
    TEST_MIGRATIONS: import('@cloudflare/vitest-plugin').D1Migration[];
  }
  interface GlobalProps {
    mainModule: typeof import('../src/index');
  }
}
