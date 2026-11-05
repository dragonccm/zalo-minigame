import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5174,
    strictPort: false,
    watch: {
      usePolling: true,
      interval: 800,
      ignored: ['**/node_modules/**', '**/public/**', '**/.git/**', '**/dist/**'],
    },
    proxy: {
      '/api': 'http://localhost:8080',
      '/g': 'http://localhost:8080',
      '/sdk': 'http://localhost:8080',
      '/preview': 'http://localhost:8080',
      '/rt': {
        target: 'ws://localhost:8080',
        ws: true,
      },
    },
  },
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
});
