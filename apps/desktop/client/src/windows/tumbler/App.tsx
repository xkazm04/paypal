import { lazy, Suspense } from 'react';
import { backend } from '../../lib/runtime';
import { Tumbler } from './Tumbler';

// In a plain browser there is no native window, so the Tumbler is drawn inside a labelled
// preview stage. The stage is a separate, lazily loaded module: the shell renders only the
// Tumbler and never loads the preview code.
const Preview = lazy(() => import('./preview/Preview'));
// The scenario director (director.html) frames the bare Tumbler in a corner of its desktop.
const Framed = lazy(() => import('./preview/Framed'));

export function App() {
  if (backend().kind === 'mock') {
    const framed = new URLSearchParams(location.search).get('frame') === 'director';
    return (
      <Suspense fallback={null}>
        {framed ? <Framed /> : <Preview />}
      </Suspense>
    );
  }
  return <Tumbler />;
}
