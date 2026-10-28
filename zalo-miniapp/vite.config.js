import { defineConfig } from 'vite';

// GAMEHUB_API: địa chỉ máy chủ GameHub (HTTPS khi chạy trong Zalo), vd https://game.example.com
export default defineConfig({
  root: '.',
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  define: { __GAMEHUB_API__: JSON.stringify(process.env.GAMEHUB_API || 'http://localhost:8080') },
  server: { port: 3000 },
});
