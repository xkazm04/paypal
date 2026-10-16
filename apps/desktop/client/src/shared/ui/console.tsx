// Console kit (rebuild WP1a): the pieces the Calibre console needs that the v2 kit lacked. Styles in
// src/design/kit.css (`ui-` prefix). Every user-facing string arrives as a prop (the caller takes
// it from lib/words.ts); nothing here names an internal. No component fetches data or calls a
// command. Unknown numbers are shown as a dash, never as zero.
import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from 'react';

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

/** What an unknown value shows: a dash (never 0, never green). */
export const UNKNOWN = '–';

/** A number for display, or the dash when it is unknown (null, undefined, not finite). */
export function shownCount(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? UNKNOWN : String(n);
}

// ---- Stack: the layered sheet with the pile beneath it --------------------------------------------

export type StackProps = {
  /** Accessible name of the sheet (a region). */
  label: string;
  /** Sheets beneath the front one, drawn as a pile under it (0..3 drawn; deeper still shows 3). */
  depth?: number;
  /** The front sheet's accent (a CSS colour, e.g. a module's `var(--m-spend)`). */
  tone?: string;
  /** Something in the pile waits on the owner: the pile's lowest edge carries a gold rule. */
  gold?: boolean;
  /** Tab strip on the sheet's top edge (a TabStrip). */
  tabs?: ReactNode;
  /** The corner stamp (a small Seal), inside the sheet at the top right. */
  corner?: ReactNode;
  children?: ReactNode;
  className?: string;
};

/** Pile sheets actually drawn for a depth. */
export function pileCount(depth: number | undefined): number {
  return Math.max(0, Math.min(3, Math.floor(depth ?? 0)));
}

export function Stack({ label, depth, tone, gold, tabs, corner, children, className }: StackProps) {
  const n = pileCount(depth);
  const style = { '--c': tone ?? 'var(--steel)', '--pile': n } as CSSProperties;
  return (
    <section className={cx('ui-stack', className)} aria-label={label} data-depth={n} style={style}>
      {tabs ? <div className="ui-stack-tabs">{tabs}</div> : null}
      <div className="ui-stack-body">
        {n ? (
          <div className={cx('ui-stack-pile', gold && 'gold')} aria-hidden="true">
            {Array.from({ length: n }, (_, i) => <span key={i} className="psheet" style={{ '--i': i + 1 } as CSSProperties} />)}
          </div>
        ) : null}
        <div className="ui-stack-sheet">
          {corner ? <div className="ui-stack-corner">{corner}</div> : null}
          <div className="ui-stack-inner">{children}</div>
        </div>
      </div>
    </section>
  );
}

// ---- TabStrip and ModuleTab: index tabs on the sheet's top edge -----------------------------------

/** Next tab index for an arrow/Home/End key in a strip of n tabs, or null for any other key. */
export function nextTab(key: string, at: number, n: number): number | null {
  if (n <= 0) return null;
  if (key === 'ArrowRight') return (at + 1) % n;
  if (key === 'ArrowLeft') return (at - 1 + n) % n;
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  return null;
}

/** role="tablist" with arrow-key movement between its tabs (roving focus; selection follows a click or Enter). */
export function TabStrip({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const tabs = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []);
    const at = tabs.indexOf(e.target as HTMLElement);
    if (at < 0) return;
    const to = nextTab(e.key, at, tabs.length);
    if (to === null) return;
    e.preventDefault();
    tabs[to]?.focus();
  };
  return <div ref={ref} className={cx('ui-tabs', className)} role="tablist" aria-label={label} onKeyDown={onKeyDown}>{children}</div>;
}

export type ModuleTabProps = {
  label: ReactNode;
  active: boolean;
  onSelect: () => void;
  /** The module's colour (`var(--m-<key>)`). */
  color?: string;
  icon?: ReactNode;
  /** Items in the module; null = not known yet (shows a dash). Omit to show nothing. */
  count?: number | null;
  /** How many wait on the owner; 0 or omitted shows no badge. */
  waiting?: number;
  /** Screen-reader words for the badge, e.g. "2 need you". Required when `waiting` is set. */
  waitingLabel?: string;
  /** id of the tabpanel this tab controls. */
  controls?: string;
  id?: string;
  title?: string;
};

export function ModuleTab({ label, active, onSelect, color, icon, count, waiting, waitingLabel, controls, id, title }: ModuleTabProps) {
  const style = color ? ({ '--c': color } as CSSProperties) : undefined;
  return (
    <button type="button" role="tab" id={id} className={cx('ui-tab', active && 'active')} aria-selected={active} aria-controls={controls}
      tabIndex={active ? 0 : -1} style={style} title={title} onClick={onSelect}>
      {icon ? <span className="ico" aria-hidden="true">{icon}</span> : null}
      <span className="lbl">{label}</span>
      {count !== undefined ? <span className={cx('tt', (count === null || !Number.isFinite(count)) && 'unknown')}>{shownCount(count)}</span> : null}
      {waiting ? <span className="cnt"><span aria-hidden="true">{waiting}</span>{waitingLabel ? <span className="sr-only">{waitingLabel}</span> : null}</span> : null}
    </button>
  );
}

// ---- FilterChips: a group of toggle chips ---------------------------------------------------------

export type FilterOption<T extends string> = { value: T; label: ReactNode; count?: number | null; title?: string };

/** The selection after pressing `v`: multi toggles it; single picks it, or clears when it was the one picked. */
export function toggleFilter<T extends string>(value: readonly T[], v: T, multi: boolean): T[] {
  const on = value.includes(v);
  if (multi) return on ? value.filter((x) => x !== v) : [...value, v];
  return on ? [] : [v];
}

export function FilterChips<T extends string>({ label, options, value, onChange, multi = true, className }: {
  label: string; options: readonly FilterOption<T>[]; value: readonly T[]; onChange: (next: T[]) => void; multi?: boolean; className?: string;
}) {
  return (
    <div className={cx('ui-filters', className)} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className="ui-filter" aria-pressed={value.includes(o.value)} title={o.title}
          onClick={() => onChange(toggleFilter(value, o.value, multi))}>
          <span>{o.label}</span>
          {o.count !== undefined ? <span className="n">{shownCount(o.count)}</span> : null}
        </button>
      ))}
    </div>
  );
}

// ---- Facts: the strip of three-ish facts under a decision -----------------------------------------

export type FactTone = 'gold' | 'teal' | 'coral' | 'ok' | 'red';
export type Fact = { key: string; k: ReactNode; v: ReactNode | null | undefined; tone?: FactTone; note?: ReactNode; num?: boolean };

export function Facts({ items, label, className }: { items: readonly Fact[]; label?: string; className?: string }) {
  return (
    <dl className={cx('ui-facts', className)} aria-label={label}>
      {items.map((f) => {
        const unknown = f.v === null || f.v === undefined || f.v === '';
        return (
          <div key={f.key} className={cx('ui-fact', f.tone, unknown && 'unknown')}>
            <dt>{f.k}</dt>
            <dd className={cx(f.num && 'num')}>{unknown ? UNKNOWN : f.v}</dd>
            {f.note ? <dd className="note">{f.note}</dd> : null}
          </div>
        );
      })}
    </dl>
  );
}

// ---- ListShell: a list with a search / filter / sort toolbar --------------------------------------

export type ListShellProps = {
  /** Accessible name of the list region. */
  label: string;
  search?: ReactNode;
  filters?: ReactNode;
  sort?: ReactNode;
  /** A short count or summary line at the toolbar's end, e.g. "48 of 312". */
  summary?: ReactNode;
  actions?: ReactNode;
  /**
   * The rows. WP1b's windowing plugs in here: pass a function that renders the visible window
   * (e.g. a TanStack Virtual list) and the shell stays the scroll container (`.ui-list-body`,
   * reachable through `bodyRef`). Without it, `children` render as they are.
   */
  renderRows?: () => ReactNode;
  children?: ReactNode;
  /** Shown instead of the rows when `isEmpty`. */
  empty?: ReactNode;
  isEmpty?: boolean;
  footer?: ReactNode;
  bodyRef?: Ref<HTMLDivElement>;
  className?: string;
};

export function ListShell({ label, search, filters, sort, summary, actions, renderRows, children, empty, isEmpty, footer, bodyRef, className }: ListShellProps) {
  const tools = search || filters || sort || summary || actions;
  return (
    <section className={cx('ui-list', className)} aria-label={label}>
      {tools ? (
        <div className="ui-list-tools">
          {search ? <div className="search">{search}</div> : null}
          {filters ? <div className="filters">{filters}</div> : null}
          <span className="ui-spacer" />
          {summary ? <span className="summary">{summary}</span> : null}
          {sort ? <div className="sort">{sort}</div> : null}
          {actions ? <div className="actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className="ui-list-body" ref={bodyRef}>
        {isEmpty && empty ? <div className="ui-empty">{empty}</div> : renderRows ? renderRows() : children}
      </div>
      {footer ? <div className="ui-list-foot">{footer}</div> : null}
    </section>
  );
}

// ---- Depth: how deep the stack is, as four rising bars --------------------------------------------

export function Depth({ value, max = 4, label, className }: { value: number; max?: number; label?: string; className?: string }) {
  const n = Math.max(1, Math.floor(max));
  const on = Math.max(0, Math.min(n, Math.floor(value)));
  return (
    <span className={cx('ui-depth', className)} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {Array.from({ length: n }, (_, i) => <i key={i} className={i < on ? 'on' : undefined} style={{ height: `${((i + 1) / n) * 100}%` }} />)}
    </span>
  );
}

