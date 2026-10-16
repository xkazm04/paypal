// One table in detail (rebuild WP3a): where it stands, its price ladder (the owner's limit as a line
// she drags or types) and the three steps that change it: set the limit, read what changes, sign it
// in the approval window. Main never signs: the last step is `approval_open` with the band draft as
// a pre-fill, and the draft ends only when Rust rebinds the deal to a newer signed version. The
// transcript is read only for the table that is open here (never per row of a list).
// Pure logic: modules/tables/ladder.ts.
import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Currency } from '@bindings/Currency';
import type { Deal } from '@bindings/Deal';
import type { TranscriptStep } from '@bindings/TranscriptStep';
import { clockLabel } from '../../../../../lib/format';
import { marketWords, TABLES } from '../../../../../lib/words';
import { WalletNotice } from '../../../../../shared/honesty';
import { Btn, Chip, Disclosure, Field, Hint, Kv, Loading, Section, Sheet, Silence } from '../../../../../shared/ui';
import { isLive, stateLabel } from '../../../logic';
import {
  bandOf, consequences, diffLines, draftValid, fenceKey, fits, ladderScale, lastPriced, LIMIT_WORD, moveFence, parseAmount, priceAt, short, standing, standLine, stepStates, toInput, topPct, unitOf,
  type BandDraft, type Priced, type Scale,
} from '../../../modules/tables/ladder';
import type { Display } from '../../../world';
import { HandOff, useTranscript } from './parts';

/** States in which a new price range may still apply (approval/gating.ts BAND_MOVABLE). */
const BAND_MOVABLE = new Set<Deal['state']>(['PAIRING', 'LISTED', 'NEGOTIATING']);

/** One table's unsent draft and how far it got (kept by the layer, so it survives a view change). */
export type TableState = { draft: BandDraft | null; read: boolean; handoff: { version: number; draft: BandDraft } | null };
export const EMPTY_TABLE: TableState = { draft: null, read: false, handoff: null };

export type StepHandlers = {
  onDraft: (d: BandDraft | null) => void;
  onRead: () => void;
  onDiscard: () => void;
  onHandoff: (version: number, draft: BandDraft) => void;
};

/** The ladder's scale from what is signed and known (transcript, signed band, market). */
function scaleFor(steps: readonly TranscriptStep[] | undefined, band: BandDraft | null, deal: Deal): Scale | null {
  const cur = deal.terms.currency;
  const m = deal.market && deal.market.median.currency === cur ? deal.market : null;
  return ladderScale([
    ...(steps ?? []).map((s) => (s.price && s.price.currency === cur ? s.price.minor : null)),
    band?.ceiling, band?.floor, m?.p25.minor, m?.p75.minor,
  ]);
}

/** "Inside your limit: $11 below the most you’ll pay ($340)." or null when there is nothing to compare. */
export function roomLine(deal: Pick<Deal, 'side' | 'terms'>, price: number | null, band: BandDraft | null): string | null {
  const cur = deal.terms.currency;
  const s = standing({ band, theirs: price === null ? null : { seq: 0, price, typ: 'COUNTER' }, side: deal.side });
  const bound = band?.[fenceKey(deal.side)] ?? null;
  if (s.kind === 'no-limit') return TABLES.noLimit;
  if (s.kind === 'no-offer' || bound === null) return null;
  const buyer = deal.side === 'buyer';
  const f = (m: number) => short(m, cur);
  if (s.kind === 'inside') return s.gap ? TABLES.inside(f(s.gap), buyer, f(bound)) : TABLES.atLimit(f(bound));
  return TABLES.past(f(s.gap ?? 0), buyer, f(bound));
}

/** The whole table: stand line, ladder, the market and the three steps. */
export function TableDetail({ deal, disp, need, who, st, steps: h, onToast }: {
  deal: Deal; disp: Display; need: AttentionItem | undefined; who: string; st: TableState; steps: StepHandlers; onToast: (text: string, tone?: 'gold' | 'ok') => void;
}) {
  const tr = useTranscript(deal.id);
  const cur = deal.terms.currency;
  const unit = unitOf(cur);
  const signed = bandOf(disp.band);
  const band = st.draft ?? signed;
  const scale = useMemo(() => scaleFor(tr.data, signed, deal) ?? (st.draft ? ladderScale([st.draft.ceiling, st.draft.floor]) : null),
    [tr.data, signed, deal, st.draft]);
  const theirs = tr.data ? lastPriced(tr.data, 'them', cur) : null;
  const yours = tr.data ? lastPriced(tr.data, 'you', cur) : null;
  const movable = BAND_MOVABLE.has(deal.state);
  const startValue = deal.market?.median.minor ?? theirs?.price ?? (scale ? Math.round((scale.lo + scale.hi) / 2 / unit) * unit : null);
  const draftTo = (v: number) => h.onDraft(moveFence(band ?? { floor: null, ceiling: null }, deal.side, v, scale, unit));
  const onStart = startValue !== null && movable ? () => draftTo(startValue) : null;
  const left = disp.band ? Math.max(0, disp.band.max_rounds - disp.band.rounds_used) : null;
  const m = deal.market && deal.market.median.currency === cur ? deal.market : null;

  return (
    <div className="tb-detail">
      <p className="tb-standline">
        {tr.data ? standLine({ band, theirs, side: deal.side, who, currency: cur }) : null}
        {tr.data && left !== null && isLive(deal) ? <span className="tb-left">{TABLES.offersLeft(left)}</span> : null}
        {st.handoff ? <Chip tone="gold" title={TABLES.waitingChipTitle}>{TABLES.waitingChip}</Chip>
          : st.draft ? <Chip tone="gold" title={TABLES.draftChipTitle}>{TABLES.draftChip}</Chip> : null}
      </p>
      {tr.error ? <WalletNotice error={tr.error} what={TABLES.offersWhat} message={TABLES.offersUnread} /> : null}
      {!tr.data && !tr.error ? <Loading what={TABLES.offersReading} /> : (
        <Ladder deal={deal} steps={tr.data ?? []} scale={scale} signed={signed} draft={st.draft} theirs={theirs} need={need} who={who}
          movable={movable} onFence={draftTo} onStart={onStart} empty={disp.on_silence} />
      )}
      {!movable ? <Hint>{TABLES.fixedRange}</Hint> : null}
      <div className="tb-more">
        <Disclosure summary={TABLES.legendTitle}>
          <Kv items={TABLES.legend(deal.side === 'buyer', who)} />
        </Disclosure>
        <Disclosure summary={m ? TABLES.marketRange(short(m.p25.minor, cur), short(m.p75.minor, cur)) : TABLES.marketTitle}>
          {m ? (
            <>
              <Kv items={[
                [TABLES.marketUsual, <span className="num">{short(m.p25.minor, cur)} – {short(m.p75.minor, cur)}</span>],
                [TABLES.marketMiddle, <span className="num">{short(m.median.minor, cur)}</span>],
                theirs ? [TABLES.marketTheirs(who), <>{short(theirs.price, cur)} · {marketWords(theirs.price, m.p25.minor, m.median.minor, m.p75.minor).text}</>] : null,
                [TABLES.marketChecked, `${clockLabel(m.retrieved_at)}${m.cached ? TABLES.marketSaved : ''}`],
              ]} />
              <Hint>{TABLES.marketNotAdvice}</Hint>
            </>
          ) : <Hint>{TABLES.marketNone}</Hint>}
        </Disclosure>
      </div>
      <BandSteps deal={deal} disp={disp} st={st} need={need} who={who} theirs={theirs} yours={yours} signed={signed} scale={scale} movable={movable}
        onStart={onStart} {...h} onToast={onToast} />
    </div>
  );
}

function Ladder({ deal, steps, scale, signed, draft, theirs, need, who, movable, onFence, onStart, empty }: {
  deal: Deal; steps: readonly TranscriptStep[]; scale: Scale | null; signed: BandDraft | null; draft: BandDraft | null; theirs: Priced | null;
  need: AttentionItem | undefined; who: string; movable: boolean; onFence: (v: number) => void; onStart: (() => void) | null; empty: string | null;
}) {
  const cur = deal.terms.currency;
  const unit = unitOf(cur);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  const band = draft ?? signed;
  const key = fenceKey(deal.side);
  const fence = band?.[key] ?? null;
  const signedFence = signed?.[key] ?? null;
  const bound = key === 'ceiling' ? TABLES.boundBuyer : TABLES.boundSeller;
  const label = TABLES.ladderLabel(deal.terms.item_ref);
  if (!scale) {
    return (
      <div className="tb-ladder tb-ladder-empty" role="group" aria-label={label}>
        <div className="tb-nofence">
          <b>{TABLES.noPrices}</b>
          <Hint>{empty ?? TABLES.noPricesHint}</Hint>
          {movable ? <Hint>{TABLES.typeToStart(bound)}</Hint> : null}
        </div>
      </div>
    );
  }
  const t = (v: number) => `${topPct(v, scale)}%`;
  const live = isLive(deal);
  const priced = steps.filter((s) => s.price && s.price.currency === cur);
  // One chip per height per side: an older offer too close to a newer one stays in the record (and the
  // deal page) but is not drawn over it, so no chip is ever cut or overprinted.
  const drawn = new Set<number>();
  {
    const kept: Record<string, number[]> = {};
    for (let i = priced.length - 1; i >= 0; i--) {
      const s = priced[i];
      if (!s?.price) continue;
      if (live && theirs && s.by === 'them' && s.seq === theirs.seq) continue;
      const top = topPct(s.price.minor, scale);
      const side = kept[s.by] ?? (kept[s.by] = []);
      if (side.some((t) => Math.abs(t - top) < 6)) continue;
      side.push(top);
      drawn.add(s.seq);
    }
  }
  const fill = band && (band.ceiling !== null || band.floor !== null)
    ? { top: t(band.ceiling ?? scale.hi), bottom: `${100 - topPct(band.floor ?? scale.lo, scale)}%` } : null;
  const m = deal.market && deal.market.median.currency === cur ? deal.market : null;

  const onDown = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (!movable || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
    drag.current = true;
    ref.current?.classList.add('dragging');
  };
  const onMove = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const box = ref.current;
    if (!drag.current || !box) return;
    const r = box.getBoundingClientRect();
    onFence(priceAt((e.clientY - r.top) / r.height, scale, unit));
  };
  const onUp = () => { drag.current = false; ref.current?.classList.remove('dragging'); };
  const onKey = (e: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (!movable || fence === null) return;
    const k = e.shiftKey ? 5 : 1;
    const d = ({ ArrowUp: k, ArrowDown: -k, PageUp: 10, PageDown: -10 } as Record<string, number>)[e.key];
    if (d) { e.preventDefault(); e.stopPropagation(); onFence(fence + d * unit); }
  };

  return (
    <div className="tb-ladder" ref={ref} role="group" aria-label={label}>
      <span className="tb-lcol you">{TABLES.colYou}</span>
      <span className="tb-lcol mid">{TABLES.colMid}</span>
      <span className="tb-lcol them" title={TABLES.colThem(who)}>{TABLES.colThem(who)}</span>
      {scale.ticks.map((p) => <div key={p} className="tb-gl" style={{ top: t(p) }}><span>{short(p, cur)}</span></div>)}
      {fill ? <div className={`tb-band${draft ? ' draft' : ''}`} style={fill} /> : null}
      {m ? (
        <>
          <div className="tb-mk" style={{ top: t(m.p75.minor), bottom: `${100 - topPct(m.p25.minor, scale)}%` }}><span>{TABLES.typical(short(m.p25.minor, cur), short(m.p75.minor, cur))}</span></div>
          <div className="tb-med" style={{ top: t(m.median.minor) }} title={TABLES.middle(short(m.median.minor, cur))} />
        </>
      ) : null}
      {priced.map((s, i) => {
        if (!drawn.has(s.seq)) return null;
        const price = s.price?.minor ?? 0;
        const old = i < priced.length - 3;
        const out = !!band && s.by === 'you' && !fits(price, band);
        return (
          <span key={s.seq} className={`tb-chip ${s.by}${old ? ' old' : ''}${out ? ' over' : ''}${s.verified ? '' : ' unverified'}`} style={{ top: t(price) }}
            title={`${s.by === 'you' ? TABLES.you : who} ${s.typ === 'LISTING' ? TABLES.listedIt : TABLES.offered} ${short(price, cur)} · ${clockLabel(s.at)} · ${s.verified ? TABLES.checked : TABLES.unverified}`}>
            {s.typ === 'LISTING' ? <span className="s">{TABLES.listed}</span> : null}{short(price, cur)}
          </span>
        );
      })}
      {live && theirs ? (
        <div className={`tb-meet${fits(theirs.price, band) ? '' : ' no'}`} style={{ top: t(theirs.price) }}>
          <b>{short(theirs.price, cur)}</b>
          {fits(theirs.price, band)
            ? <span className="w">{theirs.typ === 'LISTING' ? TABLES.listing(who) : need ? TABLES.latestNeeds(who) : TABLES.latest(who)}</span>
            : <><span className="w">{TABLES.latest(who)}</span><span className="stamp">{deal.side === 'buyer' ? TABLES.overMax : TABLES.underMin}</span></>}
        </div>
      ) : null}
      {draft && signedFence !== null && signedFence !== fence ? (
        <div className="tb-fence ghost" style={{ top: t(signedFence) }}><span>{TABLES.signedAt(short(signedFence, cur))}</span></div>
      ) : null}
      {fence !== null ? (
        <div className={`tb-fence${draft ? ' draft' : ''}`} style={{ top: t(fence) }}>
          <span className={`tb-grip${movable ? '' : ' fixed'}`} tabIndex={0} role="slider" aria-label={`${LIMIT_WORD[key]} · ${deal.terms.item_ref}${movable ? TABLES.arrows : TABLES.fixed}`}
            title={movable ? TABLES.dragTitle : TABLES.fixedTitle}
            aria-valuemin={scale.lo / unit} aria-valuemax={scale.hi / unit} aria-valuenow={fence / unit} aria-valuetext={short(fence, cur)} aria-readonly={!movable}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}>
            {movable ? <span className="grip" aria-hidden="true" /> : null}<small>{LIMIT_WORD[key]}</small> {short(fence, cur)}{draft ? <small className="chg">{TABLES.changed}</small> : null}
          </span>
        </div>
      ) : (
        <div className="tb-nofence">
          <b>{TABLES.noRange}</b>
          <Hint>{TABLES.noRangeHint(bound)}</Hint>
          {onStart ? <Btn kind="primary" onClick={onStart}>{TABLES.startAt(m ? TABLES.startTypical(short(m.median.minor, cur)) : theirs ? short(theirs.price, cur) : TABLES.startMiddle)}</Btn> : null}
        </div>
      )}
    </div>
  );
}

function BandSteps({ deal, disp, st, need, who, theirs, yours, signed, scale, movable, onStart, onDraft, onRead, onDiscard, onHandoff, onToast }: {
  deal: Deal; disp: Display; st: TableState; need: AttentionItem | undefined; who: string; theirs: Priced | null; yours: Priced | null; signed: BandDraft | null;
  scale: Scale | null; movable: boolean; onStart: (() => void) | null; onToast: (text: string, tone?: 'gold' | 'ok') => void;
} & StepHandlers) {
  const cur = deal.terms.currency;
  const unit = unitOf(cur);
  const [sheet, setSheet] = useState(false);
  const signRef = useRef<HTMLDivElement>(null);
  const band = st.draft ?? signed;
  const drafting = !!st.draft;
  const valid = !st.draft || draftValid(st.draft);
  const [s1, s2, s3] = stepStates({ drafting, read: st.read && valid, handedOff: !!st.handoff });
  const cons = st.draft ? consequences({
    item: deal.terms.item_ref, them: who, side: deal.side, signed, draft: st.draft, theirs, yours,
    roundsUsed: disp.band?.rounds_used ?? null, maxRounds: disp.band?.max_rounds ?? null, pending: !!need && need.kind === 'gate', currency: cur,
  }) : [];
  const bad = cons.filter((c) => c.tone === 'x').length;
  const edits = st.draft ? diffLines(deal.terms.item_ref, signed, st.draft, cur) : [];
  const money = (v: number | null) => (v === null ? null : { minor: v, currency: cur });
  const draftArgs = st.draft && valid
    ? { deal_id: deal.id, target: 'deal' as const, draft: { type: 'band' as const, floor: money(st.draft.floor), ceiling: money(st.draft.ceiling) } }
    : { deal_id: deal.id };
  const ready = st.read && drafting && valid;
  const buyer = deal.side === 'buyer';
  const rounds = disp.band;

  return (
    <section className="tb-steps" aria-label={TABLES.rangeTitle}>
      <Section title={<span className={`tb-stp ${s1}`}><span className="n">1</span>{TABLES.step1}</span>} end={drafting ? <span className="tx-gold">{TABLES.changed}</span> : TABLES.asSigned}>
        {movable ? (
          band && (band.ceiling !== null || band.floor !== null) ? (
            <div className="tb-flds">
              <BoundRow label={buyer ? TABLES.mostPay : TABLES.highest} k="ceiling" band={band} signed={signed} currency={cur} unit={unit} scale={scale} primary={buyer} onDraft={onDraft} side={deal.side} />
              <BoundRow label={buyer ? TABLES.lowest : TABLES.leastAccept} k="floor" band={band} signed={signed} currency={cur} unit={unit} scale={scale} primary={!buyer} onDraft={onDraft} side={deal.side} />
              <div className="tb-fld">
                <span className="k">{TABLES.offersK}</span>
                {rounds ? (
                  <>
                    <span className="tb-tokens" role="img" aria-label={TABLES.roundsAria(rounds.rounds_used, rounds.max_rounds)}>
                      {Array.from({ length: Math.min(rounds.max_rounds, 40) }, (_, i) => <i key={i} className={i < rounds.rounds_used ? 'u' : ''} />)}
                    </span>
                    <span className="was" title={TABLES.fixedHere}>{TABLES.roundsUsed(rounds.rounds_used, rounds.max_rounds)}</span>
                  </>
                ) : <Chip tone="dashed" title={TABLES.roundsUnknownTitle}>{TABLES.roundsUnknown}</Chip>}
              </div>
              <div className="tb-fld">
                <span className="k">{TABLES.deadlineK}</span>
                <span className="num">{disp.deadline ? clockLabel(disp.deadline) : '—'}</span>
                <span className="was" title={TABLES.fixedHere}>{disp.deadline ? TABLES.deadlineFixed : TABLES.deadlineNone}</span>
              </div>
            </div>
          ) : (
            <div className="tb-flds">
              <p className="tb-norange"><b>{TABLES.noRange}</b> <span className="tx-dim">{TABLES.noRangeRow(disp.title)}</span></p>
              {onStart ? <Btn sm kind="primary" onClick={onStart}>{deal.market ? TABLES.startTypicalBtn : TABLES.startOne}</Btn>
                : <BoundRow label={buyer ? TABLES.mostPay : TABLES.leastAccept} k={buyer ? 'ceiling' : 'floor'} band={{ floor: null, ceiling: null }} signed={signed} currency={cur} unit={unit} scale={scale} primary onDraft={onDraft} side={deal.side} />}
            </div>
          )
        ) : <Hint>{TABLES.notMovable(stateLabel(deal.state, deal).toLowerCase())}</Hint>}
        {disp.on_silence && !need ? <p className="tb-gap"><Silence text={disp.on_silence} deadline={disp.deadline} /></p> : null}
      </Section>

      <Section title={<span className={`tb-stp ${s2}`}><span className="n">2</span>{TABLES.step2}</span>} end={drafting ? TABLES.changes(edits.length) : null}>
        {!drafting ? <Hint>{movable ? TABLES.hintLadder : TABLES.hintNumber}</Hint> : !valid ? (
          <Hint className="tx-red">{TABLES.invalid}</Hint>
        ) : (
          <div className="tb-check">
            <span>{bad ? <span className="tx-red">{TABLES.watch(bad)}</span> : null}{TABLES.effects(cons.length - bad)}</span>
            <span className="tx-dim">{st.read || st.handoff ? TABLES.readDone : TABLES.readFirst}</span>
            {bad ? <Chip tone="red">{TABLES.watchChip}</Chip> : null}
            <Btn sm onClick={() => setSheet(true)}>{TABLES.step2} ›</Btn>
          </div>
        )}
      </Section>

      <Section title={<span className={`tb-stp ${s3}`}><span className="n">3</span>{TABLES.step3}</span>}>
        {st.handoff ? (
          <div className="tb-waitsign">
            <p>{TABLES.waitingSign}</p>
            <p><Silence text={TABLES.rangeStays}>{TABLES.noPayPal}</Silence></p>
            <div className="tb-signrow">
              <Btn sm kind="plain" onClick={onDiscard}>{TABLES.discard}</Btn>
              <HandOff sm args={{ deal_id: deal.id }} title={TABLES.showApprovalTitle}>{TABLES.showApproval}</HandOff>
            </div>
          </div>
        ) : (
          <div className="tb-signrow" ref={signRef}>
            {/* Gold only once there is something to sign: an idle sign button never competes with the page's one decision. */}
            <HandOff args={draftArgs} kind={ready ? 'gold' : 'default'} disabled={!ready} title={TABLES.reviewSignTitle}
              onOpened={() => { if (st.draft) { onHandoff(deal.mandate_version, st.draft); onToast(TABLES.handedOff(edits.join(', ')), 'gold'); } }}>
              {TABLES.reviewSign}
            </HandOff>
            {drafting ? <Btn kind="plain" onClick={onDiscard}>{TABLES.discard}</Btn> : null}
            {drafting && !st.read ? <Hint>{TABLES.afterStep2}</Hint> : null}
          </div>
        )}
        {drafting && !st.handoff ? <p className="tb-gap"><Silence text={TABLES.ifNothingRange} /></p> : null}
      </Section>

      {sheet && st.draft ? (
        <Sheet title={TABLES.sheetTitle(disp.title)} onClose={() => setSheet(false)} className="ar-tables"
          footer={<>
            <Btn kind="danger" className="left" onClick={() => { setSheet(false); onDiscard(); }}>{TABLES.sheetDiscard}</Btn>
            <Btn onClick={() => setSheet(false)}>{TABLES.sheetKeep}</Btn>
            <Btn kind="primary" onClick={() => { onRead(); setSheet(false); requestAnimationFrame(() => signRef.current?.querySelector<HTMLButtonElement>('button')?.focus()); }}>{TABLES.sheetNext}</Btn>
          </>}>
          <Section title={TABLES.sheetRange}>
            <ul className="tb-edits">{edits.map((l) => <li key={l} className="tx-gold">{l}</li>)}</ul>
          </Section>
          <Section title={TABLES.sheetMeans}>
            <ul className="tb-ckl">
              {cons.map((c, i) => <li key={i} className={c.tone}><span className="mk" aria-hidden="true">{c.tone === 'x' ? '✗' : c.tone === 'ok' ? '✓' : '·'}</span><span className="tx">{c.text}</span></li>)}
            </ul>
          </Section>
          <Section><Kv items={TABLES.sheetFacts} /></Section>
        </Sheet>
      ) : null}
    </section>
  );
}

function BoundRow({ label, k, band, signed, currency, unit, scale, primary, onDraft, side }: {
  label: string; k: keyof BandDraft; band: BandDraft; signed: BandDraft | null; currency: Currency; unit: number; scale: Scale | null;
  primary: boolean; onDraft: (d: BandDraft | null) => void; side: 'buyer' | 'seller';
}) {
  const val = band[k];
  const was = signed?.[k] ?? null;
  const [bad, setBad] = useState(false);
  const commit = (text: string) => {
    if (!text.trim()) { setBad(false); onDraft({ ...band, [k]: null }); return; }
    const m = parseAmount(text, currency);
    if (m === null || m <= 0) { setBad(true); return; }
    setBad(false);
    onDraft(primary ? moveFence(band, side, m, null, 1) : { ...band, [k]: m });
  };
  const nudge = (d: number) => { if (val !== null) onDraft(moveFence(band, side, val + d * unit, scale, unit)); };
  return (
    <div className="tb-fld">
      <span className="k">{label}</span>
      {primary ? <Btn sm icon aria-label={TABLES.minus(label)} disabled={val === null} onClick={() => nudge(-5)}>−</Btn> : null}
      <Field key={`${k}:${val ?? ''}`} className="num" inputMode="decimal" defaultValue={val === null ? '' : toInput(val, currency)} placeholder={TABLES.none}
        aria-label={TABLES.fieldLabel(label, currency)} aria-invalid={bad}
        onBlur={(e) => commit(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(e.currentTarget.value); } }} />
      {primary ? <Btn sm icon aria-label={TABLES.plus(label)} disabled={val === null} onClick={() => nudge(5)}>+</Btn> : null}
      <span className="was">{val !== was ? (was !== null ? TABLES.was(short(was, currency)) : TABLES.isNew) : ''}</span>
    </div>
  );
}
