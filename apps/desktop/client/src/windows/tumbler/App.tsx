import { lazy, Suspense } from 'react';
import { backend } from '../../lib/runtime';
import { Tumbler } from './Tumbler';

// In a plain browser there is no native window, so the Tumbler is drawn inside a labelled
// preview stage. The stage is a separate, lazily loaded module: the shell renders only the
// Tumbler and never loads the preview code.
const Preview = lazy(() => import('./preview/Preview'));

export function App() {
  if (backend().kind === 'mock') {
    return (
      <Suspense fallback={null}>
        <Preview />
      </Suspense>
    );
  }
  return <Tumbler />;
}
