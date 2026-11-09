import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { sourceLocPlugin } from './scripts/babel/source-loc-vite-plugin.mjs';
import { assistantBridge } from './scripts/assistantBridge';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Three Tauri windows, three pages: the desktop bundle (Tauri ships dist/). The CSP is `script-src 'self';
// style-src 'self'`, so everything must ship as bundled files: no inline scripts, no inline <style>.
// The static pages of the browser preview (the director, Break The Table, the proof checker) are also
// tabs of the main window now (places #p=director|try|proof, console/layers/try.ts); the old pages stay as
// standalone entries. They are built
// only under THE_TABLE_DIRECTOR_BUILD=1 (`pnpm build:director`), never into the desktop bundle.
const DIRECTOR_BUILD = process.env.THE_TABLE_DIRECTOR_BUILD === '1';

export default defineConfig(({ command }) => ({
  // sourceLocPlugin is inert unless THE_TABLE_INSPECTOR=1 (npm run tauri:dev:test).
  // assistantBridge: dev server only (apply: 'serve'), the board's claude-code engine in the browser.
  plugins: [sourceLocPlugin(), react(), assistantBridge()],
  base: './',
  // One switch: THE_TABLE_INSPECTOR=1 drives both the Babel stamps and the overlay (mount.tsx).
  // VITE_PREVIEW_PAGES: the main window shows the browser-preview places (the scenario director) only where
  // director.html is served: vite dev (and tests) or the director build, never the desktop bundle.
  define: {
    // The grid's trial key is evaluation-only: a build inlines it, so a build carries it only when asked to.
    ...(command === 'build' && process.env.THE_TABLE_ENTERPRISE !== '1' ? { 'import.meta.env.VITE_AG_LICENSE_KEY': JSON.stringify('') } : {}),
    'import.meta.env.VITE_INSPECTOR': JSON.stringify(process.env.THE_TABLE_INSPECTOR === '1' ? '1' : ''),
    'import.meta.env.VITE_PREVIEW_PAGES': JSON.stringify(command === 'serve' || DIRECTOR_BUILD ? '1' : ''),
  },
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
  // Tests stay Community whatever is in .env.local: the licence gate has tests of its own.
  test: { environment: 'jsdom', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'], env: { VITE_AG_LICENSE_KEY: '' } },
}));
