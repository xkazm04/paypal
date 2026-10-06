// Layer 2 · Sheet: a modal panel that drops from the title bar over a scrim (ui.css .ui-sheet).
// Focuses its heading (never a button, so Enter cannot release money), keeps Tab inside, closes on
// Esc (topmost layer only, see layers.ts) and on a scrim click, and gives focus back on close.
import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useFocusOnMount, useReturnFocus, trapTab } from './focus';
import { useLayer } from './layers';

export type SheetSize = 'narrow' | 'default' | 'wide';

export type SheetProps = {
  /** Heading text; receives focus when the sheet opens. */
  title: ReactNode;
  onClose: () => void;
  size?: SheetSize;
  /** Footer content (buttons). Put a `.left` class on anything that should sit on the left. */
  footer?: ReactNode;
  /** Extra header content between the title and the close button (chips, badges). */
  head?: ReactNode;
  /** false: a scrim click does not close (Esc and the ✕ still do). Default true. */
  dismissOnScrim?: boolean;
  className?: string;
  children?: ReactNode;
};

export function Sheet({ title, onClose, size = 'default', footer, head, dismissOnScrim = true, className, children }: SheetProps) {
  const h2 = useRef<HTMLHeadingElement>(null);
  const box = useRef<HTMLElement>(null);
  const id = useId();
  useLayer(onClose, 'sheet');
  useReturnFocus();
  useFocusOnMount(h2);
  return createPortal(
    <>
      <div className="ui-scrim" aria-hidden="true" onMouseDown={dismissOnScrim ? onClose : undefined} />
      <section ref={box} className={`ui-sheet ${size === 'default' ? '' : size} ${className ?? ''}`} role="dialog" aria-modal="true" aria-labelledby={`${id}-h`}
        onKeyDown={(e) => trapTab(e, box.current)}>
        <header className="ui-sheet-h">
          <h2 id={`${id}-h`} tabIndex={-1} ref={h2}>{title}</h2>
          {head}
          <button type="button" className="ui-btn plain icon x" aria-label="Close" title="Close (Esc)" onClick={onClose}>✕</button>
        </header>
        <div className="ui-sheet-b">{children}</div>
        {footer ? <footer className="ui-sheet-f">{footer}</footer> : null}
      </section>
    </>,
    document.body,
  );
}
