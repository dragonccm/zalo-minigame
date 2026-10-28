import { defineConfig } from 'vite';

// GAMEHUB_API: địa chỉ máy chủ GameHub (HTTPS khi chạy trong Zalo), vd https://gamecenter.logthinks.com
// Zalo nạp JS dạng <script> thường (không phải module) theo app-config.json, nên build ra 1 file IIFE tên cố định.
export default defineConfig({
  base: './',
  define: { __GAMEHUB_API__: JSON.stringify(process.env.GAMEHUB_API || 'https://gamecenter.logthinks.com') },
  server: { port: 3000 },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/app.js',
        assetFileNames: 'assets/app[extname]',
      },
    },
  },
});
