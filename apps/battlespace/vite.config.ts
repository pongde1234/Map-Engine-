import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

const server = process.env.ME_SERVER ?? 'http://127.0.0.1:8787';

/**
 * A browser that closes mid-stream (a tab shut, a test browser torn down) leaves the proxy writing
 * to a dead socket. Without a listener that error is uncaught and takes the dev server down, so
 * every proxied socket gets one: the drop is logged and the server keeps serving.
 */
const resilient = (target: string, ws = false): ProxyOptions => ({
  target,
  ws,
  configure: (proxy) => {
    const warn = (where: string) => (err: Error) => console.warn(`[proxy ${where}] ${err.message}`);
    proxy.on('error', warn('request'));
    proxy.on('proxyReqWs', (_proxyReq, _req, socket) => socket.on('error', warn('ws client')));
    proxy.on('open', (proxySocket) => proxySocket.on('error', warn('ws upstream')));
  },
});

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': resilient(server),
      '/tiles': resilient(server),
      '/ws': resilient(server.replace('http', 'ws'), true),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 4000,
  },
  worker: { format: 'es' },
});
