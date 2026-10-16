/**
 * Dev-only Babel plugin: stamps each HOST JSX element with
 * `data-loc="src/.../File.tsx:LINE:COL"` so the inspector overlay (Ctrl+Shift+L) can map a clicked
 * DOM node back to its source and copy a `path:line` reference.
 *
 * Host elements only: a component's injected prop would not reliably reach its root DOM node, and
 * React 19 removed the Fiber `_debugSource` field, so we stamp the DOM and walk ancestors at runtime.
 *
 * @param {{ types: import('@babel/core').types }} babel
 */
export default function injectSourceLoc({ types: t }) {
  const ATTR = 'data-loc';

  return {
    name: 'inject-source-loc',
    visitor: {
      JSXOpeningElement(path, state) {
        const nameNode = path.node.name;
        if (nameNode.type !== 'JSXIdentifier') return;
        if (!/^[a-z]/.test(nameNode.name)) return;

        const loc = path.node.loc;
        const filename = state.file.opts.filename;
        if (!loc || !filename) return;

        const norm = filename.replace(/\\/g, '/');
        const idx = norm.lastIndexOf('/src/');
        if (idx === -1) return;
        const rel = norm.slice(idx + 1);

        const already = path.node.attributes.some(
          (a) => a.type === 'JSXAttribute' && a.name && a.name.name === ATTR,
        );
        if (already) return;

        path.node.attributes.push(
          t.jsxAttribute(
            t.jsxIdentifier(ATTR),
            t.stringLiteral(`${rel}:${loc.start.line}:${loc.start.column + 1}`),
          ),
        );
      },
    },
  };
}
