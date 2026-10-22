// A part of a window that throws while drawing shows a calm sentence and a "Try again" instead of a
// blank window. Never the error, a stack, a component or a command name: those go to the console
// only. Drawing only: a boundary catches nothing that moves money, and its "Try again" only draws
// the part again and reads again the reads that failed.
import { QueryClientContext, type QueryClient } from '@tanstack/react-query';
import { Component, useContext, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { renewFailedParts } from '../../lib/lazy';
import { BOUNDARY_RETRY, BOUNDARY_TEXT, BOUNDARY_TITLE, BOUNDARY_WINDOW_TITLE } from '../../lib/words';
import './boundary.css';

/** Where the boundary sits: the whole window, a page (a view) or one panel of a page. */
export type Layer = 'window' | 'view' | 'panel';

type Props = {
  layer: Layer;
  children: ReactNode;
  /** When any of these change, a shown fallback is dropped and the children drawn again (a route). */
  resetKeys?: readonly unknown[];
  /** Called after "Try again", before the children are drawn again. */
  onReset?: () => void;
};

type InnerProps = Props & { client: QueryClient | undefined };
type State = { failed: boolean; keys: readonly unknown[] | undefined };

const changed = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined): boolean =>
  (a?.length ?? 0) !== (b?.length ?? 0) || (a ?? []).some((x, i) => !Object.is(x, b?.[i]));

class Boundary extends Component<InnerProps, State> {
  override state: State = { failed: false, keys: this.props.resetKeys };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: InnerProps, state: State): Partial<State> | null {
    if (state.failed && changed(props.resetKeys, state.keys)) {
      renewFailedParts(); // the fallback is dropped: a lazy part that failed to load loads again
      return { failed: false, keys: props.resetKeys };
    }
    if (changed(props.resetKeys, state.keys)) return { keys: props.resetKeys };
    return null;
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // The console only: the owner sees the calm fallback.
    console.error(`[boundary:${this.props.layer}]`, error, info.componentStack);
  }

  retry = (): void => {
    // Read again only what failed; the rest of the cache stands.
    void this.props.client?.refetchQueries({ predicate: (q) => q.state.status === 'error' });
    renewFailedParts(); // a lazy part whose chunk failed loads again (React keeps the old rejection)
    this.props.onReset?.();
    this.setState({ failed: false });
  };

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const { layer } = this.props;
    return (
      <div className={`boundary boundary-${layer}`} role="alert">
        <p className="boundary-title">{layer === 'window' ? BOUNDARY_WINDOW_TITLE : BOUNDARY_TITLE}</p>
        <p className="boundary-text">{BOUNDARY_TEXT}</p>
        <button type="button" className="ui-btn" onClick={this.retry}>{BOUNDARY_RETRY}</button>
      </div>
    );
  }
}

/** Catches a drawing failure below it and shows the layer's fallback. */
export function ErrorBoundary(props: Props) {
  const client = useContext(QueryClientContext);
  return <Boundary {...props} client={client} />;
}

/** Logs every uncaught error and unhandled rejection of the window to the console (only): a
 *  failure outside a render (an event handler, a stray promise) is not silent, and is never shown
 *  as an error on screen. Returns the uninstall. Installed by the window-level boundary. */
export function installErrorLogging(target: Window = window): () => void {
  const onError = (e: ErrorEvent): void => { console.error('[window:error]', e.error ?? e.message); };
  const onRejection = (e: PromiseRejectionEvent): void => { console.error('[window:unhandledrejection]', e.reason); };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}

/** The boundary of a whole window, with the window's error logging. lib/mount.tsx mounts it. */
export function WindowBoundary({ children }: { children: ReactNode }) {
  useEffect(() => installErrorLogging(), []);
  return <ErrorBoundary layer="window">{children}</ErrorBoundary>;
}
