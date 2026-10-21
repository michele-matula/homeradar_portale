import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  // In sviluppo le API arrivano dal Worker locale (`wrangler dev` in apps/server).
  server: { proxy: { '/api': 'http://localhost:8787' } },
});
