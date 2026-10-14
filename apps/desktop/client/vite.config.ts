import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { sourceLocPlugin } from './scripts/babel/source-loc-vite-plugin.mjs';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Three Tauri windows, three pages. The CSP is `script-src 'self'; style-src 'self'`,
// so everything must ship as bundled files: no inline scripts, no inline <style>.
export default defineConfig({
  // sourceLocPlugin is inert unless THE_TABLE_INSPECTOR=1 (npm run tauri:dev:test).
  plugins: [sourceLocPlugin(), react()],
  base: './',
  resolve: {
    alias: {
      '@bindings': here('../../../bindings'),
      '@': here('./src'),
    },
  },
  server: { port: 1430, strictPort: true, fs: { allow: [here('../../..')] } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    cssCodeSplit: true,
    rollupOptions: {
      input: {
        main: here('./index.html'),
        tumbler: here('./tumbler.html'),
        approval: here('./approval.html'),
        // Browser preview only: the scenario director (src/director). The shell never opens it.
        director: here('./director.html'),
      },
    },
  },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
});
