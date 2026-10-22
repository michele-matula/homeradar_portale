import { execSync } from 'node:child_process';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Commit corrente: va negli errori del portale per sapere da quale build arrivano. */
function gitVersion(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim() || 'dev';
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(gitVersion()) },
  build: { outDir: 'dist', emptyOutDir: true },
  // In sviluppo le API arrivano dal Worker locale (`wrangler dev` in apps/server).
  server: { proxy: { '/api': 'http://localhost:8787' } },
});
