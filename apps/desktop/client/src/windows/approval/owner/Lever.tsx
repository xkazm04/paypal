// One amount lever: clause number, title, what the change does, the typed value, and a track
// with this week’s deals as ticks (coloured by the wallet’s answer for the draft) and a notch at the signed
// value. Drag, use the arrow keys or type; the typed string stays the source of truth.
import { useId, useRef, type ReactNode } from 'react';
import type { Currency } from '@bindings/Currency';
import { formatMinor } from '../../../lib/format';
import { ruleNameOf } from '../../../lib/words';
import { Chip } from '../../../shared/ui';
import { minorToInput, parseMoneyInput } from '../model';
import type { Dir } from './diff';
import { frac, leverRange, toMinor, toSlider, type Tick } from './levers';

const DIR_TONE = { widens: 'gold', restricts: 'teal', changes: 'line' } as const;
export function DirChip({ dir }: { dir: Dir }) {
  return <Chip tone={DIR_TONE[dir]}>{dir}</Chip>;
}

const pos = (f: number) => `calc(7px + (100% - 14px) * ${f.toFixed(4)})`;

export type LeverProps = {
  n: number;
  title: string;
  /** The draft's typed value ('' = none). */
  value: string;
  currency: Currency;
  /** The signed version's value in minor units (null = none signed / not set). */
  signed: number | null;
  /** null = this week's deals are not readable (no ticks, said so). */
  ticks: Tick[] | null;
  /** What the ticks are, for the hint when there are none. */
  tickNote?: string;
  dir?: Dir;
  /** '' allowed (an optional bound). */
  optional?: boolean;
  onChange: (text: string) => void;
  onRemove?: () => void;
  children?: ReactNode;
};

export function Lever({ n, title, value, currency, signed, ticks, tickNote, dir, optional, onChange, onRemove, children }: LeverProps) {
  const id = useId();
  const typed = value.trim() ? parseMoneyInput(value, currency) : null;
  const bad = value.trim() !== '' && typed === null;
  // Nothing signed and no deals yet (a new wallet): the scale follows the first amount it was
  // given (a starting set of rules), held still so dragging never stretches it.
  const anchor = useRef<number | null>(null);
  if (anchor.current === null && typed !== null && typed > 0) anchor.current = typed;
  const range = leverRange(signed, (ticks ?? []).map((t) => t.x), currency, anchor.current);
  const off = (ticks ?? []).filter((t) => t.x > range.max);
  const sliderMax = Math.round(range.max / range.unit);
  const slider = typed === null ? 0 : Math.min(toSlider(range, typed), sliderMax);
  return (
    <div className={`ow-lever ${dir ? 'chg' : ''}`}>
      <div className="lh">
        <label className="lt" htmlFor={`${id}-v`} title={title}>{title}</label>
        {dir ? <DirChip dir={dir} /> : null}
        <span className="ro">
          <input
            id={`${id}-v`}
            className={`ui-field num ${bad ? 'bad' : ''}`}
            inputMode="decimal"
            value={value}
            placeholder={optional ? 'none' : ''}
            aria-invalid={bad}
            aria-describedby={bad ? `${id}-e` : undefined}
            onChange={(e) => onChange(e.target.value)}
          />
          <span className="cur">{currency}</span>
        </span>
        {onRemove ? (
          <button type="button" className="ui-btn plain icon sm x" aria-label={`Remove “${ruleNameOf(n)}”`} title={`Remove “${ruleNameOf(n)}”`} onClick={onRemove}>✕</button>
        ) : null}
      </div>
      <div className="track">
        <div className="ticks" aria-hidden="true">
          {signed !== null ? <span className="notch" style={{ left: pos(frac(range, signed)) }} title={`now ${formatMinor(signed, currency)}`} /> : null}
          {(ticks ?? []).filter((t) => t.x <= range.max).map((t) => (
            <span key={t.id} className={`tk ${t.outcome}`} style={{ left: pos(frac(range, t.x)) }} title={`${t.tip} · draft: ${t.outcome}`} />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={sliderMax}
          step={1}
          value={slider}
          aria-label={title}
          aria-valuetext={typed === null ? (optional ? 'none' : 'not set') : formatMinor(typed, currency)}
          onChange={(e) => onChange(minorToInput(toMinor(range, Number(e.target.value)), currency))}
        />
      </div>
      <div className="scale">
        <span>{formatMinor(range.min, currency)}</span>
        {off.length ? (
          <span className="off">{off.length} deal{off.length > 1 ? 's' : ''} off scale → {formatMinor(Math.max(...off.map((t) => t.x)), currency)}</span>
        ) : (
          <span>{signed !== null ? `▾ now ${formatMinor(signed, currency)}` : 'not set yet'}</span>
        )}
        <span>{formatMinor(range.max, currency)}</span>
      </div>
      {ticks === null ? <p className="ui-hint ow-noticks">{tickNote ?? 'This week’s deals are marked here once your wallet has tried these rules.'}</p> : null}
      {bad ? <p id={`${id}-e`} className="ui-hint red" role="alert">“{value}” is not an amount in {currency}</p> : null}
      {children ? <div className="sub">{children}</div> : null}
    </div>
  );
}
