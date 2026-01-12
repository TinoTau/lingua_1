import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 9001,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});

