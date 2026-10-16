/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { authDevPlugin } from './server/devMiddleware';

// O Spotify não aceita "localhost" como redirect URI: use o endereço de loopback explícito.
export default defineConfig(({ mode }) => ({
  plugins: [react(), authDevPlugin(loadEnv(mode, process.cwd(), ''))],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
}));
