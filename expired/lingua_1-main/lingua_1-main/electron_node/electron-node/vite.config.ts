import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: './renderer',
  build: {
    outDir: '../renderer/dist',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './renderer/src'),
    },
  },
  server: {
    hmr: {
      overlay: false, // 禁用错误覆盖层，避免 ESBuild 崩溃
    },
    // 增加服务器稳定性
    watch: {
      usePolling: false,
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'node14',
      // 增加 ESBuild 的稳定性
      logOverride: { 'this-is-undefined-in-esm': 'silent' },
    },
  },
  esbuild: {
    // 增加 ESBuild 的稳定性配置
    logOverride: { 'this-is-undefined-in-esm': 'silent' },
    target: 'es2020',
  },
});

