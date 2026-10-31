import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { sourceLocPlugin } from './scripts/babel/source-loc-vite-plugin.mjs';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Three Tauri windows, three pages: the desktop bundle (Tauri ships dist/). The CSP is `script-src 'self';
// style-src 'self'`, so everything must ship as bundled files: no inline scripts, no inline <style>.
// The static pages of the browser preview (the director, Break The Table, the proof checker) are built
// only under THE_TABLE_DIRECTOR_BUILD=1 (`pnpm build:director`), never into the desktop bundle.
const DIRECTOR_BUILD = process.env.THE_TABLE_DIRECTOR_BUILD === '1';

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
        // Dev and preview only: the scenario director (src/director), Break The Table (src/arena, the
        // judge's attack page; the console hosts the same component as the place "Try to break it") and
        // the proof checker on a page of its own (src/proof, no wallet, no backend). Served by `vite` dev;
        // built statically only by `pnpm build:director` for the no-install judge path.
        ...(DIRECTOR_BUILD ? { director: here('./director.html'), arena: here('./arena.html'), proof: here('./proof.html') } : {}),
      },
    },
  },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
});
