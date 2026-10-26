import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const server = process.env.ME_SERVER ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': server,
      '/tiles': server,
      '/ws': { target: server.replace('http', 'ws'), ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 4000,
  },
  worker: { format: 'es' },
});
