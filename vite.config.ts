import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        classroom: fileURLToPath(new URL('./classroom.html', import.meta.url)),
      },
    },
  },
  server: {
    port: 5173,
    open: true,
  },
});
