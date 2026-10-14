import injectSourceLoc from './inject-source-loc.mjs';

/**
 * Opt-in Vite plugin: stamps host JSX elements with `data-loc` for the inspector overlay
 * (Ctrl+Shift+L). Runs only when THE_TABLE_INSPECTOR=1 (set by `npm run tauri:dev:test`), so a normal
 * build or a release never carries the attribute. `enforce: 'pre'` runs it before JSX is lowered.
 */
export function sourceLocPlugin() {
  const enabled = process.env.THE_TABLE_INSPECTOR === '1';
  /** @type {typeof import('@babel/core') | undefined} */
  let babel;
  return {
    name: 'the-table-source-loc',
    enforce: 'pre',
    async buildStart() {
      if (enabled && !babel) babel = await import('@babel/core');
    },
    async transform(code, id) {
      if (!enabled || !babel) return null;
      const file = id.split('?')[0] ?? id;
      if (!/\.[jt]sx$/.test(file) || file.includes('/node_modules/')) return null;
      const result = await babel.transformAsync(code, {
        filename: file,
        configFile: false,
        babelrc: false,
        sourceMaps: true,
        parserOpts: { plugins: ['jsx', 'typescript'] },
        plugins: [injectSourceLoc],
      });
      if (!result || result.code == null) return null;
      return { code: result.code, map: result.map ?? null };
    },
  };
}
