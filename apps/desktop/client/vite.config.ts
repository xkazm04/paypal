import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { sourceLocPlugin } from './scripts/babel/source-loc-vite-plugin.mjs';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Three Tauri windows, three pages, and the proof checker's page (a plain static page, no wallet). The CSP is `script-src 'self'; style-src 'self'`,
// so everything must ship as bundled files: no inline scripts, no inline <style>.
export default defineConfig({
  // sourceLocPlugin is inert unless THE_TABLE_INSPECTOR=1 (npm run tauri:dev:test).
  plugins: [sourceLocPlugin(), react()],
  base: './',
  // One switch: THE_TABLE_INSPECTOR=1 drives both the Babel stamps and the overlay (mount.tsx).
  define: { 'import.meta.env.VITE_INSPECTOR': JSON.stringify(process.env.THE_TABLE_INSPECTOR === '1' ? '1' : '') },
  resolve: {
    alias: {
      '@bindings': here('../../../bindings'),
      '@': here('./src'),
    },
  },
  server: { port: 1430, strictPort: true, fs: { allow: [here('.'), here('../../../bindings')] } },
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
        // The proof checker on a page of its own (no wallet, no backend): a static page like the director.
        proof: here('./proof.html'),
        // Dev-only: the scenario director (src/director), served by `vite` dev and absent from the
        // release bundle (Tauri ships dist/). Built statically only by `pnpm build:director`
        // (THE_TABLE_DIRECTOR_BUILD=1) for the no-install judge path.
        ...(process.env.THE_TABLE_DIRECTOR_BUILD === '1' ? { director: here('./director.html') } : {}),
      },
    },
  },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
});
