// The switchboard: six module rows by four fate columns, every deal one key in its cell. Heads
// filter; keys open the decision behind them; a cell with more keys than room shows a count and one
// "+n more" key. The board never scrolls: rows share the height, and the cells fold what does not fit.
// Keyboard: arrows move between keys (one tab stop, roving), Enter opens, Esc is the board's (the
// parent). Everything drawn here is a read of the model; nothing here can move money.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Module } from '@bindings/Module';
import { FATES, MODULE_KEYS, type Fate } from '../../../lib/assistant';
import { BOARD_CORNER, BOARD_COUNT_SOON, BOARD_EMPTY_CELL, BOARD_FATE, BOARD_FILTER_COL, BOARD_FILTER_ROW, BOARD_GRID_LABEL, BOARD_IF_NOTHING, BOARD_KEY_LABEL, BOARD_MODULE_ROLE, BOARD_MORE, BOARD_MORE_TITLE, BOARD_NO_DEADLINE, BOARD_WEEK_HEAD, BOARD_WEEK_LABEL } from '../../../lib/words';
import { countdown, countdownWords } from '../../../lib/format';
import { useNow } from '../../../lib/hooks';
import { clockNow } from '../../../lib/clock';
import { Countdown } from '../../../shared/honesty';
import { Glyph, MODULE } from '../../../shared/modules';
import { CELL_PAD, pickDensity, visibleCount, type Density } from './fit';
import { amountText, Amount, Shape } from './parts';
import type { BoardKey, BoardModel } from './useBoardModel';

export type Filter = { module: Module | null; fate: Fate | null };
export type Highlight = { module: Module | null; fate: Fate | null; deal_id: string | null };
export const NO_FILTER: Filter = { module: null, fate: null };

type Slot = { m: Module; f: Fate; i: number };
const sameSlot = (a: Slot | null, b: Slot | null): boolean => !!a && !!b && a.m === b.m && a.f === b.f && a.i === b.i;

export type MatrixProps = {
  model: BoardModel;
  filter: Filter;
  highlight: Highlight | null;
  selId: string | null;
  onKey: (id: string) => void;
  onMore: (m: Module, f: Fate) => void;
  onRow: (m: Module) => void;
  onCol: (f: Fate) => void;
};

/** Does a key pass the filter (a dimmed key is still drawn and still clickable). */
export const passes = (f: Filter, module: Module, fate: Fate): boolean => (!f.module || f.module === module) && (!f.fate || f.fate === fate);

function litKey(h: Highlight | null, k: BoardKey): boolean {
  if (!h) return false;
  if (h.deal_id) return h.deal_id === k.id;
  return (!h.module || h.module === k.module) && (!h.fate || h.fate === k.fate);
}
const litRow = (h: Highlight | null, m: Module): boolean => !!h && (h.deal_id ? false : h.module === m);
const litCol = (h: Highlight | null, f: Fate): boolean => !!h && (h.deal_id ? false : h.fate === f);

/** Measures the cells: the inner height one cell has, or null when nothing can be measured (a test). */
function useCellHeight(ref: React.RefObject<HTMLDivElement | null>): number | null {
  const [avail, setAvail] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const head = el.querySelector<HTMLElement>('.sb-colheads')?.getBoundingClientRect().height ?? 0;
      const h = el.getBoundingClientRect().height;
      if (!h) return;
      const row = (h - head - 6) / 6;
      const next = Math.max(0, Math.floor(row - CELL_PAD));
      setAvail((p) => (p === next ? p : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return avail;
}

export function Matrix({ model, filter, highlight, selId, onKey, onMore, onRow, onCol }: MatrixProps) {
  const ref = useRef<HTMLDivElement>(null);
  const avail = useCellHeight(ref);
  const density: Density = useMemo(() => pickDensity(MODULE_KEYS.flatMap((m) => FATES.map((f) => model.cells[m][f].keys)), avail), [model.cells, avail]);
  const shown = useMemo(() => Object.fromEntries(MODULE_KEYS.map((m) => [m, Object.fromEntries(FATES.map((f) => [f, visibleCount(model.cells[m][f].keys, avail, density)]))])) as Record<Module, Record<Fate, number>>, [model.cells, avail, density]);
  const slotsIn = useCallback((m: Module, f: Fate): number => shown[m][f] + (model.cells[m][f].count > shown[m][f] ? 1 : 0), [shown, model.cells]);

  // The one tab stop: the slot the owner last used, else the first needs-you key, else the first key.
  const first = useMemo<Slot | null>(() => {
    for (const f of FATES) for (const m of MODULE_KEYS) if (slotsIn(m, f)) return { m, f, i: 0 };
    return null;
  }, [slotsIn]);
  const [active, setActive] = useState<Slot | null>(null);
  const stop: Slot | null = active && active.i < slotsIn(active.m, active.f) ? active : first;

  const move = useCallback((from: Slot, dir: 'left' | 'right' | 'up' | 'down'): Slot | null => {
    if (dir === 'left' || dir === 'right') {
      const step = dir === 'right' ? 1 : -1;
      for (let j = FATES.indexOf(from.f) + step; j >= 0 && j < FATES.length; j += step) {
        const f = FATES[j]!;
        const n = slotsIn(from.m, f);
        if (n) return { m: from.m, f, i: Math.min(from.i, n - 1) };
      }
      return null;
    }
    const step = dir === 'down' ? 1 : -1;
    const n = slotsIn(from.m, from.f);
    if (from.i + step >= 0 && from.i + step < n) return { ...from, i: from.i + step };
    for (let j = MODULE_KEYS.indexOf(from.m) + step; j >= 0 && j < MODULE_KEYS.length; j += step) {
      const m = MODULE_KEYS[j]!;
      const c = slotsIn(m, from.f);
      if (c) return { m, f: from.f, i: step > 0 ? 0 : c - 1 };
    }
    return null;
  }, [slotsIn]);

  const [wantFocus, setWantFocus] = useState<Slot | null>(null);
  useEffect(() => {
    if (!wantFocus) return;
    ref.current?.querySelector<HTMLElement>(`[data-slot="${wantFocus.m}:${wantFocus.f}:${wantFocus.i}"]`)?.focus();
    setWantFocus(null);
  }, [wantFocus]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const dir = e.key === 'ArrowLeft' ? 'left' : e.key === 'ArrowRight' ? 'right' : e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowDown' ? 'down' : null;
    if (!dir) return;
    const at = (e.target as HTMLElement).closest<HTMLElement>('[data-slot]')?.dataset.slot?.split(':');
    if (!at || at.length !== 3) return;
    e.preventDefault();
    const next = move({ m: at[0] as Module, f: at[1] as Fate, i: Number(at[2]) }, dir);
    if (next) { setActive(next); setWantFocus(next); }
  };

  const now = clockNow();
  const soonestAll = FATES.map((f) => MODULE_KEYS.reduce<number | null>((s, m) => { const x = model.cells[m][f].soonest_s; return x !== null && (s === null || x < s) ? x : s; }, null));

  return (
    <div className="sb-matrix" ref={ref} role="group" aria-label={BOARD_GRID_LABEL} data-density={density} data-measured={avail === null ? 'no' : 'yes'} onKeyDown={onKeyDown}>
      <div className="sb-colheads" role="presentation">
        <div className="sb-corner">{BOARD_CORNER}</div>
        {FATES.map((f, j) => (
          <button key={f} type="button" className={`sb-ch c-${f}${filter.fate === f ? ' on' : ''}${litCol(highlight, f) ? ' lit' : ''}`} onClick={() => onCol(f)}
            aria-pressed={filter.fate === f} title={`${BOARD_FILTER_COL(BOARD_FATE[f].word)}. ${BOARD_FATE[f].means}`} data-col={f}>
            <span className="sb-w"><Shape fate={f} />{BOARD_FATE[f].word}</span>
            <span className="sb-n num" data-count={f}>{model.colCount[f]}</span>
            <span className="sb-x">{soonestAll[j] !== null ? <>{BOARD_COUNT_SOON('')}<SoonLeft deadline={soonestAll[j]!} now={now} /></> : ' '}</span>
          </button>
        ))}
        <div className="sb-corner sb-weekhead">{BOARD_WEEK_HEAD}</div>
      </div>
      {MODULE_KEYS.map((m) => {
        const meta = MODULE[m];
        const week = model.week[m];
        const maxDay = Math.max(1, ...week.days);
        return (
          <div key={m} className={`sb-row${filter.module && filter.module !== m ? ' dim' : ''}`} style={{ '--mc': meta.cssVar } as CSSProperties} data-row={m}>
            <button type="button" className={`sb-rh${filter.module === m ? ' on' : ''}${litRow(highlight, m) ? ' lit' : ''}`} onClick={() => onRow(m)} aria-pressed={filter.module === m} title={BOARD_FILTER_ROW(meta.name)} data-rowhead={m}>
              <Glyph module={m} className="sb-glyph" />
              <span className="sb-nm">{meta.name}</span>
              <span className="sb-rl">{BOARD_MODULE_ROLE[m]}</span>
              <span className="sb-tally">
                {FATES.map((f) => (model.cells[m][f].count ? <span key={f} className={`c-${f}`} title={BOARD_FATE[f].word}><Shape fate={f} size={11} /><span className="num">{model.cells[m][f].count}</span></span> : null))}
              </span>
            </button>
            {FATES.map((f) => {
              const cell = model.cells[m][f];
              const n = shown[m][f];
              const rest = cell.count - n;
              return (
                <ul key={f} className={`sb-cell lane-${f}${cell.count ? '' : ' empty'}${!passes(filter, m, f) ? ' dim' : ''}${highlight && !highlight.deal_id && (!highlight.module || highlight.module === m) && (!highlight.fate || highlight.fate === f) && (highlight.module || highlight.fate) ? ' lit' : ''}`}
                  data-cell={`${m}:${f}`} data-count={cell.count} aria-label={`${meta.name}, ${BOARD_FATE[f].word}: ${cell.count}`}>
                  {cell.count === 0 ? <li className="sb-none" aria-label={BOARD_EMPTY_CELL} /> : null}
                  {cell.keys.slice(0, n).map((k, i) => (
                    <li key={k.id}>
                      <KeyButton k={k} density={density} dim={!passes(filter, m, f)} lit={litKey(highlight, k)} sel={selId === k.id} slot={{ m, f, i }} stop={sameSlot(stop, { m, f, i })}
                        onOpen={() => { setActive({ m, f, i }); onKey(k.id); }} onFocus={() => setActive({ m, f, i })} />
                    </li>
                  ))}
                  {rest > 0 ? (
                    <li>
                      <button type="button" className="sb-more" data-slot={`${m}:${f}:${n}`} tabIndex={sameSlot(stop, { m, f, i: n }) ? 0 : -1} data-more={`${m}:${f}`}
                        title={BOARD_MORE_TITLE(rest, meta.name, BOARD_FATE[f].word)} aria-label={BOARD_MORE_TITLE(rest, meta.name, BOARD_FATE[f].word)}
                        onFocus={() => setActive({ m, f, i: n })} onClick={() => { setActive({ m, f, i: n }); onMore(m, f); }}>
                        {BOARD_MORE(rest)}
                      </button>
                    </li>
                  ) : null}
                </ul>
              );
            })}
            <div className="sb-week" role="img" aria-label={BOARD_WEEK_LABEL(meta.name, week.total)} data-week={m}>
              <span className="sb-bars" aria-hidden="true">
                {week.days.map((d, i) => <i key={i} className={`${i === week.today ? 'now' : ''}${d ? ' on' : ''}`} style={{ '--h': `${d ? 18 + Math.round((d / maxDay) * 82) : 8}%` } as CSSProperties} />)}
              </span>
              <span className="sb-tot num">{week.total}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SoonLeft({ deadline, now }: { deadline: number; now: number }) {
  const t = useNow();
  return <span className="num" aria-label={countdownWords(deadline, t || now)}>{countdown(deadline, t || now)}</span>;
}

function KeyButton({ k, density, dim, lit, sel, slot, stop, onOpen, onFocus }: {
  k: BoardKey; density: Density; dim: boolean; lit: boolean; sel: boolean; slot: Slot; stop: boolean; onOpen: () => void; onFocus: () => void;
}) {
  const meta = MODULE[k.module];
  const amt = amountText(k);
  const left = k.deadline_s !== null ? countdownWords(k.deadline_s, clockNow()) : null;
  const label = BOARD_KEY_LABEL(meta.name, BOARD_FATE[k.fate].word, `${k.title} (${k.label})`, amt, left);
  const title = `${k.label} · ${k.title}${k.on_silence ? `\n${BOARD_IF_NOTHING}: ${k.on_silence}` : ''}`;
  return (
    <button type="button" className={`sb-key f-${k.fate} d-${density}${dim ? ' dim' : ''}${lit ? ' lit' : ''}${sel ? ' sel' : ''}`} style={{ '--mc': meta.cssVar } as CSSProperties}
      data-slot={`${slot.m}:${slot.f}:${slot.i}`} data-deal={k.id} tabIndex={stop ? 0 : -1} aria-label={label} aria-pressed={sel} title={title} onClick={onOpen} onFocus={onFocus}>
      <Glyph module={k.module} className="sb-kglyph" />
      <span className="sb-kt">{k.title}</span>
      <span className="sb-ka"><Amount k={k} /></span>
      <span className="sb-ks">
        <span className={`sb-fate c-${k.fate}`}><Shape fate={k.fate} size={11} /><span className="sb-fw">{BOARD_FATE[k.fate].short}</span></span>
        {k.fate === 'needs' ? (k.deadline_s !== null ? <Countdown deadline={k.deadline_s} className="sb-cd" /> : <span className="sb-cd none">{BOARD_NO_DEADLINE}</span>) : <em>{k.state_word}</em>}
      </span>
      {k.fate === 'needs' && k.on_silence ? <span className="sb-kq"><b>{BOARD_IF_NOTHING}:</b> {k.on_silence}</span> : null}
    </button>
  );
}
