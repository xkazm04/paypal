// Move the band for the selected haggle (band_set): Rust signs and rebinds a new mandate
// version, before settlement only. The owner types amounts; they are parsed exactly into minor
// units here, and Rust validates them against the mandate.
import { useState } from 'react';
import type { Deal } from '@bindings/Deal';
import type { Money } from '@bindings/Money';
import type { WalletError } from '../../lib/contract';
import { formatMoney } from '../../lib/format';
import type { DealDisplay } from '../../lib/pending';
import { WalletNotice } from '../../shared/honesty';
import { Btn, Field } from '../../shared/ui';
import type { Gate } from './gating';
import { bandMissingSide, refusalWords } from './mandateDraft';
import { minorToInput, parseMoneyInput } from './model';
import { useSession } from './session';

export function BandAdjust({ deal, band, gate, onDone, draft }: {
  deal: Deal; band: DealDisplay['band']; gate: Gate; onDone: () => Promise<void>;
  /** The band The Table drafted (approval_handoff): pre-fills the form, opened. Nothing is signed until Sign. */
  draft?: { floor: Money | null; ceiling: Money | null } | null;
}) {
  const s = useSession();
  const cur = deal.terms.currency;
  const seed = draft && [draft.floor, draft.ceiling].every((v) => !v || v.currency === cur) ? draft : null;
  const [open, setOpen] = useState(!!seed);
  const [floor, setFloor] = useState(seed ? (seed.floor ? minorToInput(seed.floor.minor, cur) : '') : band?.floor ? minorToInput(band.floor.minor, cur) : '');
  const [ceiling, setCeiling] = useState(seed ? (seed.ceiling ? minorToInput(seed.ceiling.minor, cur) : '') : band?.ceiling ? minorToInput(band.ceiling.minor, cur) : '');
  const [error, setError] = useState<WalletError | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // undefined = not a valid amount; null = left empty (no floor / no ceiling).
  const parse = (t: string): Money | null | undefined => {
    if (!t.trim()) return null;
    const m = parseMoneyInput(t, cur);
    return m === null ? undefined : { minor: m, currency: cur };
  };
  const f = parse(floor);
  const c = parse(ceiling);
  const invalid = f === undefined || c === undefined || (f === null && c === null) || (!!f && !!c && f.minor > c.minor);
  const missing = invalid ? null : bandMissingSide(deal.side, f, c);

  const sign = async () => {
    if (invalid || f === undefined || c === undefined) return;
    setError(null);
    setDone(null);
    const r = await s.call('band_set', { deal_id: deal.id, floor: f, ceiling: c }, true);
    if (r.ok) {
      setDone(`Signed. The price range is now ${[c ? `most you’ll pay ${formatMoney(c)}` : null, f ? `least you’ll accept ${formatMoney(f)}` : null].filter(Boolean).join(', ')}.`);
      setOpen(false);
    } else setError(r.error);
    await onDone();
  };

  return (
    <div className="dr-band">
      <div className="dr-mkt">
        <span className="k">Price range</span>
        {band ? (
          <span className="t">
            {band.ceiling ? `most you’ll pay ${formatMoney(band.ceiling)} · ` : ''}
            {band.floor ? `least you’ll accept ${formatMoney(band.floor)} · ` : ''}offer {band.rounds_used} of {band.max_rounds}
          </span>
        ) : (
          <span className="t dim">not shown in this window yet</span>
        )}
        <Btn kind="plain" sm aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Close' : 'Change price range'}
        </Btn>
      </div>
      {open ? (
        <div className="band-form">
          <label>
            <span>Least you’ll accept ({cur})</span>
            <Field inputMode="decimal" className="num" value={floor} onChange={(e) => setFloor(e.target.value)} placeholder="none" aria-invalid={f === undefined} />
          </label>
          <label>
            <span>Most you’ll pay ({cur})</span>
            <Field inputMode="decimal" className="num" value={ceiling} onChange={(e) => setCeiling(e.target.value)} placeholder="none" aria-invalid={c === undefined} />
          </label>
          <Btn kind="gold" disabled={!gate.enabled || !!invalid || s.pending !== null} onClick={() => void sign()} title={gate.reason ?? undefined}
            onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}>
            {s.pending === 'band_set' ? 'Signing…' : 'Sign new range'}
          </Btn>
          {missing ? <p className="ui-hint gold" role="note">{missing}</p> : null}
          <p className="ui-hint">{seed ? 'Filled in from your draft in The Table. Check both amounts: nothing is signed until you sign here. ' : ''}Updates your rules for this deal before it’s agreed. It doesn’t pay anything.</p>
        </div>
      ) : null}
      {done ? <p className="dr-hint" role="status"><span className="ui-chip ok">Signed</span><span className="t" title={done}>{done}</span></p> : null}
      {error ? <WalletNotice error={error} what="Price range not changed" message={error.code === 'REFUSED' ? refusalWords(error.message) : undefined} /> : null}
    </div>
  );
}
