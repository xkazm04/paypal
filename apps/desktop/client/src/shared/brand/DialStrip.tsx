// The small Dial kept as presence (owner's choice): a compact strip of six module segments, each a
// row of beads (one per deal) in its state colour. Fed only by props; it fetches nothing and does
// nothing. One plain label describes it (role="img"); the beads themselves are ornamental.
// Unknown states are dashed outlines, never filled; a segment with more deals than `max` shows the
// first `max` beads and a "+n" tail.
import type { CSSProperties } from 'react';
import type { Module } from '@bindings/Module';
import type { ChipTone } from '../ui/components';
import './brand.css';

export type DialStripItem = {
  module: Module;
  /** One tone per deal, in display order (ChipTone: teal moving, coral held, gold needs you, ok settled, red refused, dashed unknown). */
  beads: readonly ChipTone[];
  /** True when something in this module needs the owner (a gold tick over the segment). */
  waiting?: boolean;
};

export type DialStripProps = {
  items: readonly DialStripItem[];
  /** Plain words for the whole strip, e.g. "Your wallet: 14 deals, 2 need you". */
  label: string;
  /** Beads shown per module before the "+n" tail. Default 8. */
  max?: number;
  className?: string;
};

/** The beads a segment shows and how many are left over. */
export function stripBeads(beads: readonly ChipTone[], max: number): { shown: readonly ChipTone[]; more: number } {
  const n = Math.max(0, Math.floor(max));
  return { shown: beads.slice(0, n), more: Math.max(0, beads.length - n) };
}

export function DialStrip({ items, label, max = 8, className }: DialStripProps) {
  return (
    <div className={`br-strip${className ? ` ${className}` : ''}`} role="img" aria-label={label}>
      {items.map((it) => {
        const { shown, more } = stripBeads(it.beads, max);
        const style = { '--mc': `var(--m-${it.module})` } as CSSProperties;
        return (
          <span key={it.module} className="seg" data-m={it.module} data-waiting={it.waiting ? '' : undefined} style={style}>
            {shown.map((t, i) => <i key={i} className={`bead ${t}`} />)}
            {more ? <span className="more">+{more}</span> : null}
          </span>
        );
      })}
    </div>
  );
}
