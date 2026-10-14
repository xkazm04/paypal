// A layer that loads its code (a lazy page) or waits for a read that suspends: a calm loading line
// while it waits, and the layer's error fallback if it fails. Drawing only.
import { Suspense, type ReactNode } from 'react';
import { LAYER_LOADING } from '../../lib/words';
import { ErrorBoundary, type Layer } from './ErrorBoundary';
import './boundary.css';

export function LayerSuspense({ layer, children, fallback, resetKeys }: { layer: Layer; children: ReactNode; fallback?: ReactNode; resetKeys?: readonly unknown[] }) {
  return (
    <ErrorBoundary layer={layer} {...(resetKeys ? { resetKeys } : {})}>
      <Suspense fallback={fallback ?? <p className="layer-loading" role="status">{LAYER_LOADING}</p>}>{children}</Suspense>
    </ErrorBoundary>
  );
}
