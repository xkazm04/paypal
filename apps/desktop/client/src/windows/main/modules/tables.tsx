// Tables (haggle) module page. UX round 1 (docs/ux/ROUND-1.md): the page opens on an answer
// ("Is a deal waiting for me, and is it inside my limit?"), then a decision card per table that needs
// the owner, then one card per live table with a one-line "where it stands" bar (your offers, their
// offers, your limit). Detailed view keeps the specialist instrument: the table tabs and the vertical
// price ladder (prototype/pages/tables/variant-3) where the limit is dragged. Moving the limit
// drafts a band change that goes through three steps in the Inspector: draft → what changes (a
// sheet) → sign in the approval window. Main never signs: band_set and every countersign / accept
// run only in the approval window (approval_open hands off).
// Owner: the tables agent. Styles: ./tables.css, scoped under .mod-tables. Pure logic: ./tables/ladder.ts.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Currency } from '@bindings/Currency';
import type { Deal } from '@bindings/Deal';
import type { TranscriptStep } from '@bindings/TranscriptStep';
import { clockLabel } from '../../../lib/format';
import { headlineWords, marketWords, ruleNameOf, sellerSaysOnly, silenceWords, stateWord } from '../../../lib/words';
import { useMutation, useQuery } from '../../../lib/hooks';
import { Countdown, MinorMoney, WalletNotice } from '../../../shared/honesty';
import { Glyph } from '../../../shared/modules';
import {
  AnswerBar, Btn, Chip, DecisionCard, DetailToggle, Explainer, Field, Group, Hint, Icon, Inspector, Kv, Loading, PageHead, Popover, Row, Section, Sheet, Silence,
  useDetail, useLayer, type ChipTone, type DecisionOption, type ExplainerStep,
} from '../../../shared/ui';
import { canWithdraw, dealTotal, isLive, isOwnerAccept, stateLabel } from '../logic';
import { useCpLookup, useToast } from '../ui';
import { useWorld } from '../world';
import type { ModuleProps } from './common';
import { NoteChip } from './shield/NoteChip';
import { ShopAroundButton, ShopAroundCards } from './tables/ShopAround';
import {
  bandOf, consequences, diffLines, draftValid, fenceKey, fits, ladderScale, lastPriced, moveFence, parseAmount, posPct, priceAt,
  LIMIT_WORD, sameBand, short, standLine, standing, stepStates, tabLine, toInput, topPct, unitOf, type BandDraft, type Consequence, type Priced, type Scale,
} from './tables/ladder';
import './tables.css';

/** States in which band_set may still move the band (approval/gating.ts BAND_MOVABLE). */
const BAND_MOVABLE = new Set<Deal['state']>(['PAIRING', 'LISTED', 'NEGOTIATING']);

type TableState = { draft: BandDraft | null; read: boolean; handoff: { version: number; draft: BandDraft } | null };
const EMPTY: TableState = { draft: null, read: false, handoff: null };

const EXPLAIN: readonly ExplainerStep[] = [
  { icon: 'agent', title: 'Your agent haggles', text: 'It trades offers with the other wallet’s agent for you.' },
  { icon: 'shield', title: 'Never past your limit', text: 'It can’t offer or accept anything outside the price range you signed.' },
  { icon: 'you', title: 'You approve the price', text: 'Nothing is accepted until you confirm in the approval window.' },
];

/** The wallet's default-on-silence sentence in plain words (no protocol verbs on this surface). */
const plainSilence = (s: string): string => silenceWords(s).replace(/SETTLE/g, 'payment request');

/** "Refurbished 27-inch 4K monitor" → "the refurbished 27-inch 4K monitor" (only a plain capitalised first word is lowered). */
const asItem = (title: string): string => `the ${/^[A-Z][a-z]/.test(title) ? title.charAt(0).toLowerCase() + title.slice(1) : title}`;

/** The Tables page. The root (.module.mod-tables, --mc) comes from ModuleView. */
export function Tables({ deals, nav }: ModuleProps) {
  const w = useWorld();
  const toast = useToast();
  const [detail, setDetail] = useDetail('tables');
  const detailed = detail === 'detailed';
  // The strip: live tables plus anything that still needs you (a MISMATCH carries a needs-you item).
  const strip = useMemo(() => deals.filter((d) => isLive(d) || !!w.needOf(d.id)), [deals, w]);
  const closed = useMemo(() => deals.filter((d) => !strip.includes(d)), [deals, strip]);
  const live = strip.filter(isLive).length;
  const needDeals = strip.filter((d) => w.needOf(d.id));
  const others = strip.filter((d) => isLive(d) && !w.needOf(d.id));
  const [sel, setSel] = useState<string | null>(null);
  const cur = strip.find((d) => d.id === sel) ?? strip[0] ?? null;
  // Simple view: the table whose price range is open in the Inspector (nothing is open by default).
  const [edit, setEdit] = useState<string | null>(null);
  const editDeal = !detailed ? strip.find((d) => d.id === edit) ?? null : null;
  const act = detailed ? cur : editDeal;

  const [ts, setTs] = useState<Record<string, TableState>>({});
  const stateOf = (id: string): TableState => ts[id] ?? EMPTY;
  const patch = (id: string, p: Partial<TableState>) => setTs((x) => ({ ...x, [id]: { ...(x[id] ?? EMPTY), ...p } }));

  // A hand-off ends when Rust rebinds the deal to a newer mandate version (band_set signed).
  useEffect(() => {
    for (const [id, s] of Object.entries(ts)) {
      if (!s.handoff) continue;
      const d = deals.find((x) => x.id === id);
      if (d && d.mandate_version > s.handoff.version) {
        setTs((x) => ({ ...x, [id]: EMPTY }));
        toast(<>Your new price range for <b>{w.display(d).label}</b> is signed and in use. The other side never sees your limit.</>, 'ok');
      }
    }
  }, [deals, ts, toast, w]);

  const discard = (id: string, say?: boolean) => {
    patch(id, EMPTY);
    if (say) toast(<>Change discarded. Your signed price range still applies.</>);
  };
  const actState = act ? stateOf(act.id) : EMPTY;
  // Esc discards an unsent draft before it leaves the page (the prototype's Esc rule).
  useLayer(() => { if (act) discard(act.id, true); }, 'other', !!act && !!actState.draft && !actState.handoff);

  /** The draft callbacks of one table's band steps. */
  const handlers = (d: Deal) => ({
    onDraft: (x: BandDraft | null) => {
      const signed = bandOf(w.display(d).band);
      const had = stateOf(d.id).handoff;
      patch(d.id, { draft: x && !sameBand(x, signed) ? x : null, read: false, handoff: null });
      if (had) toast(<>Draft changed · the approval-window request no longer matches. Hand off again when done.</>);
    },
    onRead: () => patch(d.id, { read: true }),
    onDiscard: () => discard(d.id, true),
    onHandoff: (version: number, draft: BandDraft) => patch(d.id, { handoff: { version, draft } }),
  });

  const [closedA, setClosedA] = useState<HTMLElement | null>(null);
  // Shop around (T8): the groups of sellers for one item, each seller's latest signed price.
  const groups = useQuery('deal_groups', null, { refreshOn: ['deal:changed'] });
  const actions = (
    <>
      <DetailToggle value={detail} onChange={setDetail} />
      <Btn aria-haspopup="dialog" onClick={(e) => { const t = e.currentTarget; setClosedA((x) => (x ? null : t)); }}>Closed · {closed.length} ▾</Btn>
      <ShopAroundButton groups={groups.data ?? []} deals={deals} onGrouped={() => void groups.refetch()} />
      <Btn kind="primary" onClick={() => nav.onSheet('pairing')} title="Start haggling with another wallet over an item, join with a code, or try the house seller">Open a table</Btn>
    </>
  );

  return (
    <div className="tb-page">
      <PageHead title="Tables" icon={<Glyph module="tables" />} focusKey="tables" sub="Your agent haggles inside the price range you signed" actions={actions} />
      {closedA ? (
        <Popover anchor={closedA} onClose={() => setClosedA(null)} title={`Closed · ${closed.length}`} className="mod-tables">
          <Group empty="Nothing closed yet.">
            {closed.map((d) => <ClosedRow key={d.id} deal={d} onOpen={() => { setClosedA(null); nav.onDeal(d.id); }} />)}
          </Group>
        </Popover>
      ) : null}

      <TablesAnswer needDeals={needDeals} live={live} />
      <Explainer id="tables" title="How tables work" steps={EXPLAIN} />

      {needDeals.length ? (
        <section className="tb-decisions" aria-label="Waiting for you">
          {needDeals.map((d) => (
            <NeedCard key={d.id} deal={d} need={w.needOf(d.id)} st={stateOf(d.id)} nav={nav} compact={detailed} onRange={() => { setEdit(d.id); setSel(d.id); }} />
          ))}
        </section>
      ) : null}

      <ShopAroundCards groups={groups.data ?? []} deals={deals} nav={nav} />

      {!strip.length || !cur ? (
        <>
          <Group><div className="ui-empty">No tables open right now.<div className="tb-empty-act"><Btn kind="primary" onClick={() => nav.onSheet('pairing')}>Try the house seller</Btn></div></div></Group>
          {detailed ? <Inspector title="Price range"><Hint>Open a table to set a price range.</Hint></Inspector> : null}
        </>
      ) : detailed ? (
        <>
          <div className="tb-strip" role="tablist" aria-label="Live tables">
            {strip.map((d, i) => (
              <TableTab key={d.id} deal={d} on={d.id === cur.id} draft={stateOf(d.id).draft}
                onPick={() => setSel(d.id)}
                onKey={(e) => {
                  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                  e.preventDefault();
                  const n = strip[(i + (e.key === 'ArrowRight' ? 1 : strip.length - 1)) % strip.length];
                  if (n) { setSel(n.id); (document.querySelector(`[data-tab="${n.id}"]`) as HTMLElement | null)?.focus(); }
                }} />
            ))}
          </div>
          <TableBody key={cur.id} deal={cur} st={stateOf(cur.id)} nav={nav} {...handlers(cur)} />
        </>
      ) : (
        <>
          {others.length ? (
            <section className="tb-tables" aria-label="Your tables">
              <h2 className="tb-h2">Your tables <span>{others.length} open</span></h2>
              {others.map((d) => <TableCard key={d.id} deal={d} st={stateOf(d.id)} nav={nav} onRange={() => setEdit(d.id)} />)}
            </section>
          ) : null}
          {editDeal ? (
            <RangeEditor key={editDeal.id} deal={editDeal} st={stateOf(editDeal.id)} {...handlers(editDeal)}
              onClose={() => { const s = stateOf(editDeal.id); if (s.draft && !s.handoff) discard(editDeal.id, true); setEdit(null); }} />
          ) : null}
        </>
      )}
    </div>
  );
}

// ---- the answer ------------------------------------------------------------------------------------

/** "Inside your limit: $11 below the most you’ll pay ($340)." in plain words, or null when there is nothing to compare. */
function roomLine(deal: Deal, price: number | null, band: BandDraft | null): string | null {
  const cur = deal.terms.currency;
  const s = standing({ band, theirs: price === null ? null : { seq: 0, price, typ: 'COUNTER' }, side: deal.side });
  const key = fenceKey(deal.side);
  const bound = band?.[key] ?? null;
  if (s.kind === 'no-limit') return 'You haven’t set a limit for this table yet.';
  if (s.kind === 'no-offer' || bound === null) return null;
  const f = (m: number) => short(m, cur);
  const buyer = deal.side === 'buyer';
  if (s.kind === 'inside') return s.gap ? `Inside your limit: ${f(s.gap ?? 0)} ${buyer ? 'below the most you’ll pay' : 'above the least you’ll accept'} (${f(bound)}).` : `Right at your limit (${f(bound)}).`;
  return `Past your limit: ${f(s.gap ?? 0)} ${buyer ? 'above the most you’ll pay' : 'below the least you’ll accept'} (${f(bound)}). Your agent can’t accept it.`;
}

function TablesAnswer({ needDeals, live }: { needDeals: Deal[]; live: number }) {
  const w = useWorld();
  const cp = useCpLookup();
  const whoOf = (d: Deal) => shortWho(cp(d.counterparty));
  const asks = needDeals.filter((d) => w.needOf(d.id)?.actions.includes('review'));
  const lead = asks[0] ?? needDeals[0];
  const need = lead ? w.needOf(lead.id) : undefined;
  if (!lead || !need) {
    return (
      <AnswerBar tone="calm" title={live ? 'Nothing waits for you.' : 'No tables open right now.'}
        sub={live ? `${live} ${live === 1 ? 'table is' : 'tables are'} open. Your agent stays inside the price range you signed.` : 'Open a table to let your agent haggle for you.'} />
    );
  }
  const who = whoOf(lead);
  const item = asItem(w.display(lead).title);
  const amt = need.amount_minor ? short(need.amount_minor, need.currency) : null;
  const review = need.actions.includes('review');
  const rest = needDeals.length - 1;
  const more = rest ? ` ${rest} more ${rest === 1 ? 'table needs' : 'tables need'} you below.` : '';
  if (review) {
    const clause = amt ? `${who} ${isOwnerAccept(need, lead) ? 'offers' : 'agreed'} ${amt} for ${item}` : headlineWords(need.headline);
    const room = roomLine(lead, need.amount_minor ?? null, bandOf(w.display(lead).band));
    return <AnswerBar tone="need" title={`${clause}. Your call.`} sub={`${room ?? 'Nothing is accepted until you confirm.'}${more}`} />;
  }
  return <AnswerBar tone="alert" title={`${who}’s payment request for ${item} doesn’t match the price you agreed.`} sub={`Nothing can be paid on it.${more}`} />;
}

// ---- small pieces ----------------------------------------------------------------------------------

function stateTone(d: Pick<Deal, 'state'> & Partial<Pick<Deal, 'side' | 'kind'>>): ChipTone | undefined {
  if (sellerSaysOnly(d)) return 'gold';
  switch (d.state) {
    case 'CAPTURED': case 'RECEIPTED': case 'RECONCILED': return 'ok';
    case 'WITHDRAWN': case 'EXPIRED': case 'VOIDED': case 'AUTO_VOIDED': return undefined;
    case 'REFUSED': case 'MISMATCH': case 'FAILED': case 'DISPUTED': return 'red';
    case 'PAIRING': case 'LISTED': return 'line';
    case 'AWAITING_APPROVAL': case 'APPROVED': case 'AUTHORIZED': return 'gold';
    default: return 'teal';
  }
}
const StateTag = ({ deal }: { deal: Pick<Deal, 'state' | 'side' | 'kind'> }) => <Chip tone={stateTone(deal)}>{stateLabel(deal.state, deal)}</Chip>;

/** "Dan" from "Dan · north-desk"; "House seller" for the house seller. */
const shortWho = (c: { house?: boolean; name: string }): string => (c.house ? 'House seller' : c.name.split(' · ')[0] ?? c.name);
function useShortName(deal: Deal): { short: string; full: string } {
  const c = useCpLookup()(deal.counterparty);
  return { short: shortWho(c), full: c.name };
}

function ClosedRow({ deal, onOpen }: { deal: Deal; onOpen: () => void }) {
  const w = useWorld();
  const n = useShortName(deal);
  const t = dealTotal(deal);
  const struck = ['WITHDRAWN', 'EXPIRED', 'VOIDED', 'AUTO_VOIDED', 'REFUSED'].includes(deal.state);
  return (
    <Row title={w.display(deal).title} sub={n.short} onOpen={onOpen}>
      <StateTag deal={deal} />
      <span className={`amt ${struck ? 'struck' : ''}`}><MinorMoney minor={t.minor} currency={t.currency} /></span>
    </Row>
  );
}

function useTranscript(deal: Deal) {
  return useQuery('deal_transcript', { deal_id: deal.id }, { refreshOn: ['deal:changed'] });
}

/** Scale for one table from what is signed and known (transcript, signed band, market). */
function scaleFor(steps: readonly TranscriptStep[] | undefined, band: BandDraft | null, deal: Deal): Scale | null {
  const cur = deal.terms.currency;
  const m = deal.market && deal.market.median.currency === cur ? deal.market : null;
  return ladderScale([
    ...(steps ?? []).map((s) => (s.price && s.price.currency === cur ? s.price.minor : null)),
    band?.ceiling, band?.floor, m?.p25.minor, m?.p75.minor,
  ]);
}

/** Everything the bar, the ladder and the band steps read about one table. */
function useStand(deal: Deal, st: TableState) {
  const w = useWorld();
  const disp = w.display(deal);
  const tr = useTranscript(deal);
  const cur = deal.terms.currency;
  const unit = unitOf(cur);
  const signed = bandOf(disp.band);
  const band = st.draft ?? signed;
  const scale = useMemo(() => scaleFor(tr.data, signed, deal) ?? (st.draft ? ladderScale([st.draft.ceiling, st.draft.floor]) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tr.data, signed?.ceiling, signed?.floor, deal, !!st.draft]);
  const theirs = tr.data ? lastPriced(tr.data, 'them', cur) : null;
  const yours = tr.data ? lastPriced(tr.data, 'you', cur) : null;
  const movable = BAND_MOVABLE.has(deal.state);
  const startValue = deal.market?.median.minor ?? theirs?.price ?? (scale ? Math.round((scale.lo + scale.hi) / 2 / unit) * unit : null);
  return { disp, tr, cur, unit, signed, band, scale, theirs, yours, movable, startValue };
}

// ---- "where it stands": one horizontal bar per table (Simple view) ---------------------------------

function StandBar({ deal, steps, scale, band, drafting, who }: {
  deal: Deal; steps: readonly TranscriptStep[]; scale: Scale | null; band: BandDraft | null; drafting: boolean; who: string;
}) {
  const cur = deal.terms.currency;
  const key = fenceKey(deal.side);
  const limit = band?.[key] ?? null;
  const buyer = deal.side === 'buyer';
  if (!scale) {
    return <div className="tb-sb-empty">{deal.state === 'PAIRING' ? 'Connecting. Nothing is offered yet.' : 'No offers yet.'}</div>;
  }
  const theirs = lastPriced(steps, 'them', cur);
  const yours = lastPriced(steps, 'you', cur);
  const priced = steps.filter((s) => s.price && s.price.currency === cur);
  const lp = limit === null ? null : posPct(limit, scale);
  const x = (p: number) => ({ ['--x' as string]: `${p}%` });
  const label = `Where it stands: ${standLine({ band, theirs, side: deal.side, who, currency: cur })}`;
  const out = !!theirs && !fits(theirs.price, band);
  // With both latest offers on the bar, the labels point away from each other so they never overlap.
  const both = !!yours && !!theirs;
  const yourSideLeft = !yours || !theirs || posPct(yours.price, scale) <= posPct(theirs.price, scale);
  return (
    <div className="tb-sb" role="img" aria-label={label}>
      <div className="tb-sb-in">
        {lp !== null && limit !== null ? <span className={`tb-sb-lab lim ${drafting ? 'draft' : ''}`} style={x(lp)}>{drafting ? 'New limit' : LIMIT_WORD[key]} <b>{short(limit, cur)}</b></span> : <span className="tb-sb-lab none">No price range yet</span>}
        {lp !== null && (buyer ? lp <= 62 : lp >= 38) ? <span className={`tb-sb-lab past ${buyer ? 'r' : 'l'}`}>past your limit</span> : null}
        <div className="tb-sb-track">
          {lp !== null ? (
            <span className="zones">
              <i className="zone ok" style={buyer ? { left: 0, width: `${lp}%` } : { left: `${lp}%`, right: 0 }} />
              <i className="zone over" style={buyer ? { left: `${lp}%`, right: 0 } : { left: 0, width: `${lp}%` }} />
            </span>
          ) : null}
          {priced.map((s) => {
            const price = s.price?.minor ?? 0;
            const now = s.seq === (s.by === 'them' ? theirs?.seq : yours?.seq);
            const over = !fits(price, band);
            return (
              <i key={s.seq} className={`dot ${s.by} ${now ? 'now' : 'old'} ${over && now ? 'over' : ''} ${s.verified ? '' : 'unverified'}`} style={{ left: `${posPct(price, scale)}%` }}
                title={`${s.by === 'you' ? 'You' : who} ${s.typ === 'LISTING' ? 'listed it' : 'offered'} ${short(price, cur)} · ${clockLabel(s.at)}${s.verified ? '' : ' · signature could not be checked'}`} />
            );
          })}
          {lp !== null ? <i className={`mark ${drafting ? 'draft' : ''}`} style={{ left: `${lp}%` }} /> : null}
        </div>
        {yours ? <span className={`tb-sb-lab you ${both ? (yourSideLeft ? 'sl' : 'sr') : ''}`} style={x(posPct(yours.price, scale))}>You <b>{short(yours.price, cur)}</b></span> : null}
        {theirs ? <span className={`tb-sb-lab them ${out ? 'over' : ''} ${both ? (yourSideLeft ? 'sr' : 'sl') : ''}`} style={x(posPct(theirs.price, scale))}>{who} <b>{short(theirs.price, cur)}</b></span> : null}
      </div>
    </div>
  );
}

/** The bar, its one-line meaning, and what the owner can do with this table's limit. */
function StandBlock({ deal, st, who, onRange, onDeal }: { deal: Deal; st: TableState; who: string; onRange: () => void; onDeal?: () => void }) {
  const t = useStand(deal, st);
  const left = t.disp.band ? Math.max(0, t.disp.band.max_rounds - t.disp.band.rounds_used) : null;
  const ready = !!t.tr.data;
  return (
    <div className="tb-stand">
      {t.tr.error ? <WalletNotice error={t.tr.error} what="Offers" /> : !t.tr.data ? <Loading what="the offers" /> : (
        <StandBar deal={deal} steps={t.tr.data} scale={t.scale} band={t.band} drafting={!!st.draft} who={who} />
      )}
      <div className="tb-sb-foot">
        <span className="cap">
          {ready ? standLine({ band: t.band, theirs: t.theirs, side: deal.side, who, currency: t.cur }) : null}
          {ready && left !== null && isLive(deal) ? <span className="left"> · {left} {left === 1 ? 'offer' : 'offers'} left</span> : null}
        </span>
        <span className="tb-sb-acts">
          {st.handoff ? <Chip tone="gold" title="Your new price range is waiting for your signature in the approval window. Nothing changes until you sign.">Waiting for your signature</Chip>
            : st.draft ? <Chip tone="gold" title="A new limit you have not sent for signing yet. Your signed range still applies.">New limit not sent yet</Chip> : null}
          {onDeal ? <Btn kind="plain" sm onClick={onDeal}>Open deal ›</Btn> : null}
          {t.movable ? <Btn sm onClick={onRange} title="Opens the three steps to set a new limit. You sign it in the approval window.">{st.handoff || st.draft ? 'Continue price range' : 'Change price range'}</Btn> : null}
        </span>
      </div>
    </div>
  );
}

function TableCard({ deal, st, nav, onRange }: { deal: Deal; st: TableState; nav: ModuleProps['nav']; onRange: () => void }) {
  const w = useWorld();
  const disp = w.display(deal);
  const n = useShortName(deal);
  return (
    <article className="tb-card">
      <header className="tb-card-h">
        <h3 title={`${disp.title} · ${disp.label}`}>{disp.title}</h3>
        <span className="with" title={n.full}>with {n.short}</span>
        <StateTag deal={deal} />
        <NoteChip dealId={deal.id} who={n.full} />
        <span className="ui-spacer" />
        {disp.deadline && isLive(deal) ? <span className="tb-left"><Icon name="clock" size={13} />{<Countdown deadline={disp.deadline} />} left</span> : null}
      </header>
      <StandBlock deal={deal} st={st} who={n.short} onRange={onRange} onDeal={() => nav.onDeal(deal.id)} />
    </article>
  );
}

// ---- a decision: a table that needs the owner ------------------------------------------------------

/** `compact` (Detailed view) leaves the where-it-stands bar out: the price ladder below is the instrument there. */
function NeedCard({ deal, need, st, nav, onRange, compact }: { deal: Deal; need: AttentionItem | undefined; st: TableState; nav: ModuleProps['nav']; onRange: () => void; compact?: boolean }) {
  const w = useWorld();
  const toast = useToast();
  const n = useShortName(deal);
  const open = useMutation('approval_open');
  const withdraw = useMutation('deal_withdraw');
  const [ask, setAsk] = useState(false);
  if (!need) return null;
  const review = need.actions.includes('review');
  const accept = isOwnerAccept(need, deal);
  const mayWithdraw = canWithdraw(deal) && (need.actions.includes('withdraw') || deal.kind === 'haggle');
  const label = w.display(deal).label;
  const item = asItem(w.display(deal).title);
  const amt = need.amount_minor ? short(need.amount_minor, need.currency) : null;
  const question = review
    ? (amt ? (accept ? `Accept ${n.short}’s offer of ${amt} for ${item}?` : `Approve the ${amt} deal with ${n.short} for ${item}?`) : headlineWords(need.headline))
    : headlineWords(need.headline);
  const why = need.clause
    ? <>Your rule “{ruleNameOf(need.clause.number)}” keeps this decision with you.</>
    : <>{stateWord(deal.state, deal).means}</>;
  const options: DecisionOption[] = [];
  if (review) {
    options.push({
      kind: 'gold', label: <>{accept ? 'Review & accept' : 'Review & approve'} ↗</>,
      means: `Opens the approval window. ${deal.side === 'buyer' ? 'Nothing is accepted until you confirm there; you pay later on PayPal.' : 'Nothing is approved until you confirm there.'}`,
      title: w.locked ? 'Locked after 15 quiet minutes: the approval window asks for Windows Hello' : 'Opens the approval window, the only place money can be released',
      disabled: open.pending,
      onClick: async () => { const r = await open.run({ deal_id: deal.id }); if (r !== undefined) toast(<>The approval window is open. It checks your rules again before anything is signed.</>, 'gold'); },
    });
  }
  if (mayWithdraw) options.push({ kind: 'danger', label: 'Withdraw', means: 'Your agent leaves the table. No money moves.', onClick: () => setAsk(true) });
  if (!review) options.push({ label: 'Open deal', means: 'See what happened and why nothing can be paid.', onClick: () => nav.onDeal(deal.id) });
  return (
    <>
      <DecisionCard className="tb-need"
        context={<><Icon name="tag" size={14} />Table with {n.short}<StateTag deal={deal} /><NoteChip dealId={deal.id} who={n.full} /></>}
        question={question} why={why} amount={amt && review ? amt : undefined} options={options}
        silence={plainSilence(need.on_silence)} deadline={need.deadline} onDetails={() => nav.onDeal(deal.id)} detailsLabel="Open deal">
        {review && !compact ? <StandBlock deal={deal} st={st} who={n.short} onRange={onRange} /> : null}
        {open.error ? <WalletNotice error={open.error} what="Approval window" /> : null}
        {withdraw.error ? <WalletNotice error={withdraw.error} what="Withdraw" /> : null}
      </DecisionCard>
      {ask ? (
        <Sheet title={`Withdraw from ${n.short}’s table?`} size="narrow" onClose={() => setAsk(false)} className="mod-tables"
          footer={<>
            <Btn onClick={() => setAsk(false)}>Keep the table</Btn>
            <Btn kind="danger" disabled={withdraw.pending} onClick={async () => {
              const r = await withdraw.run({ deal_id: deal.id });
              setAsk(false);
              if (r === null) toast(<><b>{label}</b> withdrawn · no money moved.</>, 'ok');
            }}>{withdraw.pending ? 'Sending…' : 'Withdraw'}</Btn>
          </>}>
          <p className="tb-sheet-p">Your agent leaves the table and {label} closes.</p>
          <Kv items={[['PayPal', 'not contacted'], ['Money', 'none moves'], ['Approval', 'not needed · walking away is always safe']]} />
        </Sheet>
      ) : null}
    </>
  );
}

// ---- Detailed view: table tabs --------------------------------------------------------------------

function TableTab({ deal, on, draft, onPick, onKey }: { deal: Deal; on: boolean; draft: BandDraft | null; onPick: () => void; onKey: (e: ReactKeyboardEvent<HTMLButtonElement>) => void }) {
  const w = useWorld();
  const disp = w.display(deal);
  const need = w.needOf(deal.id);
  const n = useShortName(deal);
  const tr = useTranscript(deal);
  const cur = deal.terms.currency;
  const signed = bandOf(disp.band);
  const band = draft ?? signed;
  const theirs = tr.data ? lastPriced(tr.data, 'them', cur) : null;
  const scale = scaleFor(tr.data, signed, deal);
  const pc = (v: number) => (scale ? 100 - topPct(v, scale) : 0);
  const left = disp.band ? Math.max(0, disp.band.max_rounds - disp.band.rounds_used) : null;
  const key = fenceKey(deal.side);
  const fence = band?.[key] ?? null;
  return (
    <button type="button" role="tab" className="tb-tab" aria-selected={on} data-tab={deal.id} tabIndex={on ? 0 : -1} onClick={onPick} onKeyDown={onKey}>
      <span className="l1"><b className="who">{n.short}</b>{need ? <Chip tone="gold">Needs you</Chip> : <StateTag deal={deal} />}</span>
      <span className="nm" title={disp.title}>{disp.title}</span>
      <span className="l2">
        <span className="mm" aria-hidden="true">
          {scale && fence !== null ? <i className={draft ? 'draft' : ''} style={deal.side === 'buyer' ? { width: `${pc(fence)}%` } : { left: `${pc(fence)}%`, right: 0 }} /> : null}
          {scale && theirs ? <b className={fits(theirs.price, band) ? '' : 'no'} style={{ left: `${pc(theirs.price)}%` }} /> : null}
        </span>
        <span>{tr.error ? 'offers couldn’t be loaded' : tabLine({ band, theirs, side: deal.side, roundsLeft: left, state: deal.state, currency: cur })}{disp.deadline && isLive(deal) ? <> · <Countdown deadline={disp.deadline} /></> : null}</span>
      </span>
    </button>
  );
}

// ---- Simple view: the band steps without the chart ------------------------------------------------

type StepsProps = { onDraft: (d: BandDraft | null) => void; onRead: () => void; onDiscard: () => void; onHandoff: (version: number, draft: BandDraft) => void };

/** "Change price range" in Simple: the same three steps in the Inspector, with typed numbers instead of a dragged line. */
function RangeEditor({ deal, st, onClose, ...steps }: { deal: Deal; st: TableState; onClose: () => void } & StepsProps) {
  const w = useWorld();
  const n = useShortName(deal);
  const t = useStand(deal, st);
  const draftTo = (v: number) => steps.onDraft(moveFence(t.band ?? { floor: null, ceiling: null }, deal.side, v, t.scale, t.unit));
  return (
    <BandInspector deal={deal} st={st} need={w.needOf(deal.id)} who={n.short} theirs={t.theirs} yours={t.yours} signed={t.signed} scale={t.scale} movable={t.movable}
      ladder={false} onClose={onClose} {...steps} onStart={t.startValue !== null ? () => draftTo(t.startValue ?? 0) : null} />
  );
}

// ---- Detailed view: the selected table, ladder (Layer 1) + band steps (Inspector) -----------------

type BodyProps = { deal: Deal; st: TableState; nav: ModuleProps['nav'] } & StepsProps;

function TableBody({ deal, st, nav, onDraft, onRead, onDiscard, onHandoff }: BodyProps) {
  const w = useWorld();
  const need = w.needOf(deal.id);
  const n = useShortName(deal);
  const { disp, tr, cur, unit, signed, band, scale, theirs, yours, movable, startValue } = useStand(deal, st);

  /** Start (or move) a draft from the fence's current value. */
  const draftTo = (v: number) => onDraft(moveFence(band ?? { floor: null, ceiling: null }, deal.side, v, scale, unit));

  const [legendA, setLegendA] = useState<HTMLElement | null>(null);
  const [marketA, setMarketA] = useState<HTMLElement | null>(null);
  const toggle = (set: (f: (x: HTMLElement | null) => HTMLElement | null) => void) => (e: ReactMouseEvent<HTMLButtonElement>) => { const t = e.currentTarget; set((x) => (x ? null : t)); };

  return (
    <>
      <section className="ui-card tb-lcard" aria-label="Price ladder">
        <div className="tb-lhead">
          <h2 title={`${disp.title} · ${disp.label}`}>{disp.title}</h2>
          <span className="ref" title={n.full}>with {n.short}</span>
          <StateTag deal={deal} />
          <NoteChip dealId={deal.id} who={n.full} />
          <span className="ui-spacer" />
          <Btn kind="plain" sm icon aria-label="How to read this chart" title="How to read this chart" onClick={toggle(setLegendA)}>ⓘ</Btn>
          <Btn kind="plain" sm onClick={() => nav.onDeal(deal.id)}>Open deal ›</Btn>
        </div>
        {tr.error ? <WalletNotice error={tr.error} what="Offers" /> : null}
        {!tr.data && !tr.error ? <Loading what="the offers" /> : (
          <Ladder deal={deal} steps={tr.data ?? []} scale={scale} signed={signed} draft={st.draft} theirs={theirs} need={need} who={n.short}
            movable={movable} onFence={draftTo} onStart={startValue !== null && movable ? () => draftTo(startValue) : null} empty={disp.on_silence} />
        )}
        <div className="tb-lfoot">
          {movable ? null : <Hint>The price range is fixed once the deal is agreed.</Hint>}
          <span className="ui-spacer" />
          <Btn kind="plain" sm onClick={toggle(setMarketA)}>{deal.market ? <>Typical price {short(deal.market.p25.minor, cur)}–{short(deal.market.p75.minor, cur)} ›</> : 'Typical price ›'}</Btn>
        </div>
      </section>
      {legendA ? (
        <Popover anchor={legendA} onClose={() => setLegendA(null)} title="How to read this chart" className="mod-tables">
          <Kv items={[
            ['Line', deal.side === 'buyer' ? 'the most you’ll pay · drag it to change it' : 'the least you’ll accept · drag it to change it'],
            ['Shaded', deal.side === 'buyer' ? 'prices your agent may agree to' : 'prices your agent may agree to'],
            ['Left / right', `your offers / ${n.short}’s offers, newest brightest`],
            ['Gold box', 'the price on the table now'],
            ['Striped', 'the typical price for similar items · a comparison, not advice'],
          ]} />
        </Popover>
      ) : null}
      {marketA ? (
        <Popover anchor={marketA} onClose={() => setMarketA(null)} title="Typical price" className="mod-tables">
          {deal.market ? (
            <>
              <Kv items={[
                ['Usual range', <span className="money">{short(deal.market.p25.minor, cur)} – {short(deal.market.p75.minor, cur)}</span>],
                ['Middle', <span className="money">{short(deal.market.median.minor, cur)}</span>],
                theirs ? [`${n.short}’s price`, <>{short(theirs.price, cur)} · {marketWords(theirs.price, deal.market.p25.minor, deal.market.median.minor, deal.market.p75.minor).text}</>] : null,
                ['Checked', `${clockLabel(deal.market.retrieved_at)}${deal.market.cached ? ' · saved copy' : ''}`],
              ]} />
              <Hint className="tb-gap">A comparison with similar listings, not a recommendation.</Hint>
            </>
          ) : <Hint>No comparison for this item.</Hint>}
        </Popover>
      ) : null}
      <BandInspector deal={deal} st={st} need={need} who={n.short} theirs={theirs} yours={yours} signed={signed} scale={scale} movable={movable} ladder
        onDraft={onDraft} onRead={onRead} onDiscard={onDiscard} onHandoff={onHandoff} onStart={startValue !== null ? () => draftTo(startValue) : null} />
    </>
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
  if (!scale) {
    return (
      <div className="tb-ladder tb-ladder-empty" role="group" aria-label={`Price ladder for ${deal.terms.item_ref}`}>
        <div className="tb-nofence">
          <b>No prices yet</b>
          <Hint>{empty ?? 'Nobody has made an offer, and there is no price range or comparison to show.'}</Hint>
          {movable ? <Hint>Type {key === 'ceiling' ? 'the most you’ll pay' : 'the least you’ll accept'} on the right to start.</Hint> : null}
        </div>
      </div>
    );
  }
  const t = (v: number) => `${topPct(v, scale)}%`;
  const live = isLive(deal);
  const priced = steps.filter((s) => s.price && s.price.currency === cur);
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
    if (d) { e.preventDefault(); onFence(fence + d * unit); }
  };

  return (
    <div className="tb-ladder" ref={ref} role="group" aria-label={`Price ladder for ${deal.terms.item_ref}`}>
      <span className="tb-lcol you">Your offers</span>
      <span className="tb-lcol mid">Typical price</span>
      <span className="tb-lcol them">{who}&apos;s offers</span>
      {scale.ticks.map((p) => <div key={p} className="tb-gl" style={{ top: t(p) }}><span>{short(p, cur)}</span></div>)}
      {fill ? <div className={`tb-band ${draft ? 'draft' : ''}`} style={fill} /> : null}
      {m ? (
        <>
          <div className="tb-mk" style={{ top: t(m.p75.minor), bottom: `${100 - topPct(m.p25.minor, scale)}%` }}><span>typical {short(m.p25.minor, cur)}–{short(m.p75.minor, cur)}</span></div>
          <div className="tb-med" style={{ top: t(m.median.minor) }} title={`middle ${short(m.median.minor, cur)}`} />
        </>
      ) : null}
      {priced.map((s, i) => {
        if (live && theirs && s.by === 'them' && s.seq === theirs.seq) return null;
        const price = s.price?.minor ?? 0;
        const old = i < priced.length - 3;
        const out = !!band && s.by === 'you' && !fits(price, band);
        return (
          <span key={s.seq} className={`tb-chip ${s.by} ${old ? 'old' : ''} ${out ? 'over' : ''} ${s.verified ? '' : 'unverified'}`} style={{ top: t(price) }}
            title={`${s.by === 'you' ? 'You' : who} ${s.typ === 'LISTING' ? 'listed it' : 'offered'} ${short(price, cur)} · ${clockLabel(s.at)} · ${s.verified ? 'signature checked' : 'signature could not be checked'}${out ? ' · outside the new range, stays on record' : ''}`}>
            {s.typ === 'LISTING' ? <span className="s">listed</span> : null}{short(price, cur)}
          </span>
        );
      })}
      {live && theirs ? (
        <div className={`tb-meet ${fits(theirs.price, band) ? '' : 'no'}`} style={{ top: t(theirs.price) }}>
          <b>{short(theirs.price, cur)}</b>
          {fits(theirs.price, band)
            ? <span>{theirs.typ === 'LISTING' ? `${who}’s listing` : need ? `${who}’s latest · needs you` : `${who}’s latest`}</span>
            : <><span>{who}’s latest</span><span className="stamp">{deal.side === 'buyer' ? 'over your max' : 'under your min'}</span></>}
        </div>
      ) : null}
      {draft && signedFence !== null && signedFence !== fence ? (
        <div className="tb-fence ghost" style={{ top: t(signedFence) }}><span>signed {short(signedFence, cur)}</span></div>
      ) : null}
      {fence !== null ? (
        <div className={`tb-fence ${draft ? 'draft' : ''}`} style={{ top: t(fence) }}>
          <span className={`tb-grip ${movable ? '' : 'fixed'}`} tabIndex={0} role="slider" aria-label={`${LIMIT_WORD[key]} for ${deal.terms.item_ref}${movable ? ' · arrow keys move it' : ' · fixed'}`}
            title={movable ? 'Drag up or down, or use the arrow keys' : 'Fixed once the deal is agreed'}
            aria-valuemin={scale.lo / unit} aria-valuemax={scale.hi / unit} aria-valuenow={fence / unit} aria-valuetext={short(fence, cur)} aria-readonly={!movable}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}>
            {movable ? <span className="grip" aria-hidden="true" /> : null}<small>{LIMIT_WORD[key]}</small> {short(fence, cur)}{draft ? <small className="chg">changed</small> : null}
          </span>
        </div>
      ) : (
        <div className="tb-nofence">
          <b>No price range yet</b>
          <Hint>Your agent can’t make an offer until you set {key === 'ceiling' ? 'the most you’ll pay' : 'the least you’ll accept'}.</Hint>
          {onStart ? <Btn kind="primary" onClick={onStart}>Start at {m ? `the typical ${short(m.median.minor, cur)}` : theirs ? short(theirs.price, cur) : 'the middle'}</Btn> : null}
        </div>
      )}
    </div>
  );
}

// ---- Inspector: the three steps ------------------------------------------------------------------

function BandInspector({ deal, st, need, who, theirs, yours, signed, scale, movable, ladder, onClose, onDraft, onRead, onDiscard, onHandoff, onStart }: {
  deal: Deal; st: TableState; need: AttentionItem | undefined; who: string; theirs: Priced | null; yours: Priced | null; signed: BandDraft | null;
  scale: Scale | null; movable: boolean; /** Detailed view: the ladder is on the page and its line can be dragged. */ ladder: boolean; onClose?: () => void;
  onDraft: (d: BandDraft | null) => void; onRead: () => void; onDiscard: () => void;
  onHandoff: (version: number, draft: BandDraft) => void; onStart: (() => void) | null;
}) {
  const w = useWorld();
  const toast = useToast();
  const disp = w.display(deal);
  const cur = deal.terms.currency;
  const unit = unitOf(cur);
  const open = useMutation('approval_open');
  const [sheet, setSheet] = useState(false);
  const signRef = useRef<HTMLButtonElement>(null);
  const v = deal.mandate_version;
  const band = st.draft ?? signed;
  const drafting = !!st.draft;
  const valid = !st.draft || draftValid(st.draft);
  const [s1, s2, s3] = stepStates({ drafting, read: st.read && valid, handedOff: !!st.handoff });
  const cons: Consequence[] = st.draft ? consequences({
    item: deal.terms.item_ref, them: who, side: deal.side, signed, draft: st.draft, theirs, yours,
    roundsUsed: disp.band?.rounds_used ?? null, maxRounds: disp.band?.max_rounds ?? null, pending: !!need && need.kind === 'gate', currency: cur,
  }) : [];
  const bad = cons.filter((c) => c.tone === 'x').length;
  const edits = st.draft ? diffLines(deal.terms.item_ref, signed, st.draft, cur) : [];

  const handOff = async () => {
    if (!st.draft || !valid) return;
    const money = (m: number | null) => (m === null ? null : { minor: m, currency: cur });
    const r = await open.run({ deal_id: deal.id, target: 'deal', draft: { type: 'band', floor: money(st.draft.floor), ceiling: money(st.draft.ceiling) } });
    if (r === undefined) return;
    onHandoff(v, st.draft);
    toast(<>The approval window is open with your change filled in: <b>{edits.join(', ')}</b>. Check it and sign there. Signing changes your limits only; it never pays.</>, 'gold');
  };

  return (
    <Inspector title={ladder ? 'Price range' : 'Change price range'} sub={<>{disp.title}</>} onClose={onClose}>
      <div className="mod-tables tb-insp">
        <Section title={<span className={`tb-stp ${s1}`}><span className="n">1</span>Set your limit</span>} end={drafting ? <span className="tx-gold">changed</span> : 'as signed'}>
          {movable ? (
            band && (band.ceiling !== null || band.floor !== null) ? (
              <Group className="tb-flds">
                <BoundRow label={deal.side === 'buyer' ? 'Most you’ll pay' : 'Highest'} k="ceiling" band={band} signed={signed} currency={cur} unit={unit} scale={scale} primary={deal.side === 'buyer'} onDraft={onDraft} side={deal.side} />
                <BoundRow label={deal.side === 'seller' ? 'Least you’ll accept' : 'Lowest'} k="floor" band={band} signed={signed} currency={cur} unit={unit} scale={scale} primary={deal.side === 'seller'} onDraft={onDraft} side={deal.side} />
                <div className="ui-row tb-fld">
                  <span className="k">Offers</span>
                  {disp.band ? (
                    <>
                      <span className="tb-tokens" role="img" aria-label={`${disp.band.rounds_used} used of ${disp.band.max_rounds}`}>
                        {Array.from({ length: disp.band.max_rounds }, (_, i) => <i key={i} className={i < disp.band!.rounds_used ? 'u' : ''} />)}
                      </span>
                      <span className="was fixed" title="Fixed when you signed; not changed here">{disp.band.rounds_used} of {disp.band.max_rounds} used</span>
                    </>
                  ) : <Chip tone="dashed" title="The number of offers could not be loaded">unknown</Chip>}
                </div>
                <div className="ui-row tb-fld">
                  <span className="k">Deadline</span>
                  <span className="num">{disp.deadline ? clockLabel(disp.deadline) : '—'}</span>
                  <span className="was fixed" title="Fixed when you signed; not changed here">{disp.deadline ? 'fixed' : 'not shown'}</span>
                </div>
              </Group>
            ) : (
              <Group>
                <Row title="No price range yet" sub={`Your rules set no limit for ${disp.title}`}>
                  {onStart ? <Btn sm kind="primary" onClick={onStart}>{deal.market ? 'Start at typical' : 'Start one'}</Btn> : null}
                </Row>
                {!onStart ? <BoundRow label={deal.side === 'buyer' ? 'Most you’ll pay' : 'Least you’ll accept'} k={deal.side === 'buyer' ? 'ceiling' : 'floor'} band={{ floor: null, ceiling: null }} signed={signed} currency={cur} unit={unit} scale={scale} primary onDraft={onDraft} side={deal.side} /> : null}
              </Group>
            )
          ) : <Hint>The price range can only change while the deal is being negotiated (it is {stateLabel(deal.state, deal).toLowerCase()} now).</Hint>}
          {disp.on_silence && !need ? <div className="tb-gap"><Silence text={plainSilence(disp.on_silence)} deadline={disp.deadline} /></div> : null}
        </Section>

        <Section title={<span className={`tb-stp ${s2}`}><span className="n">2</span>Check what changes</span>} end={drafting ? `${edits.length} change${edits.length === 1 ? '' : 's'}` : null}>
          {!drafting ? <Hint>{ladder ? 'Drag the line or change a number to see the effect.' : 'Change a number to see the effect.'}</Hint> : !valid ? (
            <Hint className="tx-red">The lowest price is above the highest, or both are empty. Fix it to continue.</Hint>
          ) : (
            <Group>
              <Row onOpen={() => setSheet(true)} title={<>{bad ? <span className="tx-red">{bad} thing{bad === 1 ? '' : 's'} to watch · </span> : null}{cons.length - bad} other effect{cons.length - bad === 1 ? '' : 's'}</>}
                sub={st.read || st.handoff ? 'read ✓' : 'Open and read before signing'}>
                {bad ? <Chip tone="red">watch</Chip> : null}
              </Row>
            </Group>
          )}
        </Section>

        <Section title={<span className={`tb-stp ${s3}`}><span className="n">3</span>Sign it</span>}>
          {st.handoff ? (
            <Group className="tb-needgrp">
              <Row title="Waiting for your signature in the approval window" sub={<Silence text="your current price range stays"> · no PayPal call</Silence>} />
              <div className="ui-row tb-acts">
                <span className="ui-spacer" />
                <Btn sm kind="plain" onClick={onDiscard}>Discard</Btn>
                <Btn sm kind="gold" locked={w.locked} disabled={open.pending} onClick={() => void open.run({ deal_id: deal.id })} title="Bring the approval window back">Show approval window ↗</Btn>
              </div>
            </Group>
          ) : (
            <div className="tb-signrow">
              {/* Gold only once there is something to sign: an idle sign button never competes with the card's one decision. */}
              <Btn kind={st.read && drafting && valid ? 'gold' : undefined} ref={signRef} locked={w.locked} disabled={!(st.read && drafting && valid) || open.pending}
                onClick={() => void handOff()} title={w.locked ? 'Locked after 15 quiet minutes: the approval window asks for Windows Hello' : 'Opens the approval window, the only place new limits are signed'}>
                Review and sign ↗
              </Btn>
              {drafting ? <Btn kind="plain" onClick={onDiscard}>Discard</Btn> : null}
              {drafting && !st.read ? <Hint>after step 2</Hint> : null}
            </div>
          )}
          {open.error ? <WalletNotice error={open.error} what="Approval window" /> : null}
        </Section>
      </div>

      {sheet && st.draft ? (
        <Sheet title={`What changes for ${disp.title}`} onClose={() => setSheet(false)} className="mod-tables"
          footer={<>
            <Btn kind="danger" className="left" onClick={() => { setSheet(false); onDiscard(); }}>Discard draft</Btn>
            <Btn onClick={() => setSheet(false)}>Keep editing</Btn>
            <Btn kind="primary" onClick={() => { onRead(); setSheet(false); setTimeout(() => signRef.current?.focus(), 0); }}>Looks right · next</Btn>
          </>}>
          <Section title="Your price range">
            <Group>{edits.map((l) => <div key={l} className="ui-row"><span className="tx-gold tb-edit">{l}</span></div>)}</Group>
          </Section>
          <Section title="What it means">
            <Group className="tb-ckl">
              {cons.map((c, i) => <div key={i} className={`ui-row ${c.tone}`}><span className="mk" aria-hidden="true">{c.tone === 'x' ? '✗' : c.tone === 'ok' ? '✓' : '·'}</span><span className="tx">{c.text}</span></div>)}
            </Group>
          </Section>
          <Section>
            <Kv items={[
              ['Who signs', 'you, in the approval window'],
              ['Money', 'none moves · signing new limits never pays'],
              ['Until then', 'your current range applies · closing the approval window changes nothing'],
            ]} />
          </Section>
        </Sheet>
      ) : null}
    </Inspector>
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
    <div className="ui-row tb-fld">
      <span className="k">{label}</span>
      {primary ? <Btn sm icon aria-label={`${label} minus 5`} disabled={val === null} onClick={() => nudge(-5)}>−</Btn> : null}
      <Field key={`${k}:${val ?? ''}`} className="num" inputMode="decimal" defaultValue={val === null ? '' : toInput(val, currency)} placeholder="none"
        aria-label={`${label} (${currency})`} aria-invalid={bad}
        onBlur={(e) => commit(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(e.currentTarget.value); } }} />
      {primary ? <Btn sm icon aria-label={`${label} plus 5`} disabled={val === null} onClick={() => nudge(5)}>+</Btn> : null}
      <span className="was">{val !== was ? (was !== null ? `was ${short(was, currency)}` : 'new') : ''}</span>
    </div>
  );
}
