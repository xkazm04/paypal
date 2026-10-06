// Layer-1 building blocks: thin React wrappers over the `ui-*` classes in src/design/ui.css.
// They add no colours or sizes of their own; style a page by composing these and, where needed,
// a page CSS file scoped under the page's root class.
import { useEffect, useRef, type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type KeyboardEvent, type MouseEvent, type ReactNode, type Ref } from 'react';
import { Countdown } from '../honesty';

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

// ---- frame ----------------------------------------------------------------------------------

export function TitleBar({ children, className }: { children: ReactNode; className?: string }) {
  return <header className={cx('ui-titlebar', className)}>{children}</header>;
}

export function Spacer() {
  return <span className="ui-spacer" />;
}

export type CrumbItem = { label: ReactNode; onClick?: () => void; title?: string };
/** Breadcrumb; the last item is the current page (not clickable). */
export function Crumbs({ items, label = 'Breadcrumb' }: { items: CrumbItem[]; label?: string }) {
  return (
    <nav className="ui-crumbs" aria-label={label}>
      {items.map((c, i) => {
        const last = i === items.length - 1;
        return (
          <span key={i} className="ui-crumb-wrap">
            {i ? <span className="sep" aria-hidden="true">›</span> : null}
            {!last && c.onClick ? <button type="button" onClick={c.onClick} title={c.title}>{c.label}</button>
              : <span aria-current={last ? 'page' : undefined} title={c.title}>{c.label}</span>}
          </span>
        );
      })}
    </nav>
  );
}

export function Sidebar({ label, head, foot, children, className }: { label: string; head?: ReactNode; foot?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <nav className={cx('ui-sidebar', className)} aria-label={label}>
      {head ? <div className="ui-sb-head">{head}</div> : null}
      {children}
      {foot ? <div className="ui-sb-foot">{foot}</div> : null}
    </nav>
  );
}

export type SidebarItemProps = {
  label: ReactNode;
  onClick: () => void;
  icon?: ReactNode;
  /** Right-hand count; with `need` it becomes the gold needs-you badge. */
  count?: ReactNode;
  need?: boolean;
  countTitle?: string;
  on?: boolean;
  title?: string;
  style?: CSSProperties;
  className?: string;
};
export function SidebarItem({ label, onClick, icon, count, need, countTitle, on, title, style, className }: SidebarItemProps) {
  return (
    <button type="button" className={cx('ui-sb-item', on && 'on', className)} style={style} onClick={onClick} title={title} aria-current={on ? 'page' : undefined}>
      {icon !== undefined ? <span className="ico" aria-hidden="true">{icon}</span> : null}
      <span className="lbl">{label}</span>
      {count !== undefined && count !== null ? <span className={cx('cnt', need && 'need')} title={countTitle}>{count}</span> : null}
    </button>
  );
}

// ---- content ----------------------------------------------------------------------------------

export type PageHeadProps = {
  title: ReactNode;
  icon?: ReactNode;
  sub?: ReactNode;
  /** Small control right after the subtitle, e.g. an ⓘ that opens a Popover. */
  info?: ReactNode;
  actions?: ReactNode;
  /** Focus the h1 when this value changes (and at mount). Omit to never move focus. */
  focusKey?: unknown;
  className?: string;
  style?: CSSProperties;
};
export function PageHead({ title, icon, sub, info, actions, focusKey, className, style }: PageHeadProps) {
  const h1 = useRef<HTMLHeadingElement>(null);
  const wantsFocus = focusKey !== undefined;
  useEffect(() => { if (wantsFocus) h1.current?.focus({ preventScroll: true }); }, [focusKey, wantsFocus]);
  return (
    <div className={cx('ui-pagehead', className)} style={style}>
      {icon ? <span className="ico" aria-hidden="true">{icon}</span> : null}
      <h1 tabIndex={-1} ref={h1}>{title}</h1>
      {sub ? <span className="sub">{sub}</span> : null}
      {info}
      {actions ? <div className="actions">{actions}</div> : null}
    </div>
  );
}

export function Section({ title, end, children, className }: { title?: ReactNode; end?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('ui-section', className)}>
      {title || end ? <div className="ui-section-h">{title ? <h2>{title}</h2> : null}{end ? <span className="end">{end}</span> : null}</div> : null}
      {children}
    </section>
  );
}

/** A grouped box (macOS Settings style): rows inside get inset separators. */
export function Group({ children, className, empty, label }: { children?: ReactNode; className?: string; empty?: ReactNode; label?: string }) {
  const has = Array.isArray(children) ? children.some((c) => c !== null && c !== undefined && c !== false) : children !== null && children !== undefined && children !== false;
  return <div className={cx('ui-group', className)} role={label ? 'group' : undefined} aria-label={label}>{has ? children : <div className="ui-empty">{empty ?? 'Nothing here.'}</div>}</div>;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('ui-card', className)}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="ui-empty">{children}</div>;
}

export function Hint({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('ui-hint', className)}>{children}</p>;
}

export type RowProps = {
  /** Leading id column (mono, dim), e.g. the deal label. */
  id?: ReactNode;
  /** Anything before the text (a dot, an icon). */
  lead?: ReactNode;
  title: ReactNode;
  /** Second line; makes the row two-line (44px). */
  sub?: ReactNode;
  /** Right-hand content: chips, amount (<span className="amt">), buttons. */
  children?: ReactNode;
  /** Makes the row actionable (click / Enter / Space). Clicks on buttons inside the row do not trigger it. */
  onOpen?: () => void;
  selected?: boolean;
  /** Gold left edge: this row needs the owner. */
  need?: boolean;
  /** Show the › chevron (default: when onOpen is set). */
  chev?: boolean;
  label?: string;
  className?: string;
  style?: CSSProperties;
};
const INTERACTIVE = 'button, a, input, select, textarea, label, [role="button"], [role="link"]';
export function Row({ id, lead, title, sub, children, onOpen, selected, need, chev, label, className, style }: RowProps) {
  const act = !!onOpen;
  const own = (t: EventTarget | null, row: HTMLElement) => (t as HTMLElement | null)?.closest(INTERACTIVE) === row;
  const onClick = act ? (e: MouseEvent<HTMLDivElement>) => { if (own(e.target, e.currentTarget)) onOpen?.(); } : undefined;
  const onKeyDown = act ? (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onOpen?.(); }
  } : undefined;
  return (
    <div className={cx('ui-row', sub !== undefined && sub !== null && 'two', act && 'act', need && 'need', selected && 'on', className)} style={style}
      role={act ? 'button' : undefined} tabIndex={act ? 0 : undefined} aria-label={label} aria-current={selected ? 'true' : undefined}
      onClick={onClick} onKeyDown={onKeyDown}>
      {id !== undefined ? <span className="id">{id}</span> : null}
      {lead}
      <span className="main">
        <span className="t1">{title}</span>
        {sub !== undefined && sub !== null ? <span className="t2">{sub}</span> : null}
      </span>
      {children}
      {(chev ?? act) ? <span className="chev" aria-hidden="true" /> : null}
    </div>
  );
}

// ---- state and numbers --------------------------------------------------------------------------

export type ChipTone = 'teal' | 'coral' | 'gold' | 'ok' | 'red' | 'line' | 'dashed';
/** A state chip: text plus colour, never colour alone. With onClick it is a button. */
export function Chip({ tone, children, title, onClick, className }: { tone?: ChipTone; children: ReactNode; title?: string; onClick?: (e: MouseEvent<HTMLButtonElement>) => void; className?: string }) {
  const c = cx('ui-chip', tone, className);
  return onClick ? <button type="button" className={cx(c, 'chipbtn')} title={title} onClick={onClick}>{children}</button>
    : <span className={c} title={title}>{children}</span>;
}

export function Dot({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span className={cx('ui-dot', className)} style={style} aria-hidden="true" />;
}

export type BtnKind = 'default' | 'primary' | 'gold' | 'danger' | 'plain';
export type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** primary = teal (your side), gold = hand-off to approval / needs you, danger, plain = link-like. */
  kind?: BtnKind;
  sm?: boolean;
  /** Square icon button. */
  icon?: boolean;
  /** Draws the lock glyph: the action needs an unlock (idle lock). Does not disable the button. */
  locked?: boolean;
  ref?: Ref<HTMLButtonElement>;
};
export function Btn({ kind = 'default', sm, icon, locked, className, type = 'button', ref, ...rest }: BtnProps) {
  return <button ref={ref} type={type} className={cx('ui-btn', kind !== 'default' && kind, sm && 'sm', icon && 'icon', locked && 'locked', className)} {...rest} />;
}

export type SegOption<T extends string> = { value: T; label: ReactNode; title?: string };
/** Segmented control (one of a few). */
export function Seg<T extends string>({ value, options, onChange, label, className }: { value: T; options: readonly SegOption<T>[]; onChange: (v: T) => void; label: string; className?: string }) {
  return (
    <div className={cx('ui-seg', className)} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} title={o.title} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export type FieldProps = InputHTMLAttributes<HTMLInputElement> & { search?: boolean; ref?: Ref<HTMLInputElement> };
/** Text field (26px). `search` adds the magnifier (inline SVG; the CSP blocks data: images). */
export function Field({ search, className, ref, ...rest }: FieldProps) {
  const input = <input ref={ref} className={cx('ui-field', className)} {...rest} />;
  if (!search) return input;
  return (
    <span className="ui-searchbox">
      <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M11 11l4 4" stroke="currentColor" strokeWidth="2" /></svg>
      {input}
    </span>
  );
}

export type KvItem = readonly [ReactNode, ReactNode] | null | false | undefined;
/** Key/value list (dl.ui-kv). Falsy items are skipped. */
export function Kv({ items, className }: { items: readonly KvItem[]; className?: string }) {
  return (
    <dl className={cx('ui-kv', className)}>
      {items.map((it, i) => (it ? [<dt key={`k${i}`}>{it[0]}</dt>, <dd key={`v${i}`}>{it[1]}</dd>] : null))}
    </dl>
  );
}

export function Stat({ k, v, big, hint, children, className }: { k: ReactNode; v: ReactNode; big?: boolean; hint?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cx('ui-stat', className)}>
      <span className="k">{k}</span>
      <span className={cx('v', big && 'big')}>{v}</span>
      {children}
      {hint ? <span className="ui-hint">{hint}</span> : null}
    </div>
  );
}

/** A thin bar. value in 0..1; null = unknown (drawn dashed, never as zero). */
export function Meter({ value, tone, label }: { value: number | null; tone?: 'gold' | 'coral' | 'red'; label: string }) {
  if (value === null || !Number.isFinite(value)) {
    return <div className="ui-meter unknown" role="img" aria-label={`${label}: unknown`} />;
  }
  const v = Math.min(1, Math.max(0, value));
  return (
    <div className={cx('ui-meter', tone)} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}>
      <i style={{ width: `${v * 100}%` }} />
    </div>
  );
}

/** Hourglass: the mark for "what happens if you do nothing" (docs/ux/UX-GUIDE.md). */
export function Hourglass({ className }: { className?: string }) {
  return (
    <svg className={cx('hg', className)} viewBox="0 0 10 12" aria-hidden="true">
      <path d="M1 .75h8M1 11.25h8M2 1v1.6c0 1.3 3 2.4 3 3.4S2 8.1 2 9.4V11M8 1v1.6c0 1.3-3 2.4-3 3.4s3 2.1 3 3.4V11" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M3.3 10.4c.5-.9 1.2-1.3 1.7-1.3s1.2.4 1.7 1.3z" fill="currentColor" />
    </svg>
  );
}

/** The default on silence, one line: "⧗ If you do nothing: <b>text</b> · countdown". Every needs-you item carries one. */
export function Silence({ text, deadline, children, className }: { text?: ReactNode; deadline?: number | null; children?: ReactNode; className?: string }) {
  return (
    <span className={cx('ui-silence', className)}>
      <Hourglass /><span className="if">If you do nothing: </span>{text ? <b>{text}</b> : null}{children}
      {deadline ? <> · <Countdown deadline={deadline} /></> : null}
    </span>
  );
}

export function Loading({ what }: { what: string }) {
  return <div className="ui-loading" role="status"><span className="ui-spin" aria-hidden="true" />Reading {what}…</div>;
}
