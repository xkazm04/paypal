// A deal (#d=<deal>[&m=<module>[&v=<view>]]), the nested depth-3/4 layer every module links to
// (rebuild WP3c; replaces DealView.tsx). The title is the layer's heading; beside it the figures
// (amount, its state or money check, money right now, time left). Under it the answer in one
// sentence, the five milestones, the "If you do nothing" line, and - when the deal needs the owner
// - the one decision (deal/Decision.tsx). Then four cards that open nested views on the same sheet:
// What happened (the signed conversation and who decided), Rules that applied, Who you deal with
// and Proof from PayPal. Each view is its own chunk and reads its own record when it opens
// (scale finding #17: the page never reads every record for every view): on open the page reads
// only the conversation, the signed rules (shared with the Rules layer) and - only when PayPal
// has records for this deal - its proof, which the answer and the milestones need to say a
// payment is being checked with PayPal; and, only on an ended deal, its verified record, for the
// "What you were shown" strip (ShownStrip.tsx). Nothing here moves money: the decision hands off to the
// approval window; Start agent, Let it lapse and Withdraw are the existing commands.
import { useEffect, useMemo, useState } from 'react';
import type { Clause } from '@bindings/Clause';
import type { Deal } from '@bindings/Deal';
import type { DealEvidence } from '@bindings/DealEvidence';
import type { TranscriptStep } from '@bindings/TranscriptStep';
import type { WalletError } from '../../../../../lib/contract';
import { clockLabel, formatMoney, shortHash, shortId } from '../../../../../lib/format';
import { useMutation, useQuery } from '../../../../../lib/hooks';
import { lazyPart, preloadWhenIdle } from '../../../../../lib/lazy';
import {
  DEAL_ACT, DEAL_CARD, DEAL_DETAILS, DEAL_FIGS, DEAL_KICKER, DEAL_SIDE, DEAL_STORY, DEAL_WHO, houseRecordWord, houseWords, INSTRUCTIONS, kindWord, LATEST_OF, NOTICE_WHAT, OPEN_THE_DEAL, rulesName, silenceWords, TABLES_WATCH,
} from '../../../../../lib/words';
import { RunBadge, WalletNotice } from '../../../../../shared/honesty';
import { MODULE } from '../../../../../shared/modules';
import { Btn, Chip, Hint, Kv, Popover, Silence } from '../../../../../shared/ui';
import { actingRun, heldRefs, lastFinishedRun, latestText, mayWithdraw, mirrorStrip, readClauses, stepWords, timelineRows } from '../../../deal/model';
import { acceptedAtFloorLine, dealAnswer, ruleChecks, rulesBadge, standingFacts } from '../../../deal/story';
import { canStartAgent, isLive, isTerminal, pairingFact } from '../../../logic';
import { watchTable, worthWatching } from '../../../modules/tables/watchPick';
import { useCpLookup, useToast } from '../../../ui';
import { useDeals, useNeedOf, useRuns, useSettings, useWorldSelector, type World } from '../../../world';
import { useSheetView, type LayerNav } from '../../layers';
import { MAX_ROWS, type LatestProps } from '../../Latest';
import { DealRow, WhoChip } from '../../rows';
import { PlaceFrame, type LensCard } from '../settings/frame';
import { Reveal } from '../../stagger';
import { DealDecision, StateStrip, Summary } from './Decision';
import { InstructionsValue } from './InstructionsValue';
import { ShownStrip } from './ShownStrip';

// The views and the sheets are their own chunks, preloaded when the window is idle (LAYER_PARTS
// preloads the page; these load on the first open of their view).
const StoryView = lazyPart(() => import('./StoryView').then((m) => m.StoryView));
const RulesView = lazyPart(() => import('./RulesView').then((m) => m.RulesView));
const WhoView = lazyPart(() => import('./WhoView').then((m) => m.WhoView));
const ProofView = lazyPart(() => import('./ProofView').then((m) => m.ProofView));
const TranscriptSheet = lazyPart(() => import('./Evidence').then((m) => m.TranscriptSheet));
const InstructionsSheet = lazyPart(() => import('./Instructions').then((m) => m.InstructionsSheet));

const sel = (w: World) => ({ display: w.display, moduleOfDeal: w.moduleOfDeal });
const same = (a: ReturnType<typeof sel>, b: ReturnType<typeof sel>) => a.display === b.display && a.moduleOfDeal === b.moduleOfDeal;

/** PayPal has a record for this deal: only then can its proof carry a money check or a statement. */
const atPayPal = (d: Deal) => heldRefs(d).length > 0;

/** The views' code, for the idle preload once a deal page is drawn (the records still wait for their view). */
const VIEW_PARTS = [StoryView, RulesView, WhoView, ProofView] as const;

export function DealPage({ deal, nav }: { deal: Deal; nav: LayerNav }) {
  useEffect(() => preloadWhenIdle(VIEW_PARTS), []);
  const { display, moduleOfDeal } = useWorldSelector(sel, same);
  const disp = display(deal);
  const need = useNeedOf(deal.id);
  const module = moduleOfDeal(deal);
  const cp = useCpLookup()(deal.counterparty);

  const tr = useQuery('deal_transcript', { deal_id: deal.id }, { refreshOn: ['deal:changed'] });
  const mandates = useQuery('mandate_list', null, { refreshOn: ['settings:changed'] });
  const evq = useQuery('deal_evidence', { deal_id: deal.id }, { enabled: atPayPal(deal), refreshOn: ['deal:changed', 'receipt:created'] });
  const [fresh, setFresh] = useState<{ id: string; e: DealEvidence } | null>(null);
  const evidence = fresh && fresh.id === deal.id ? fresh.e : evq.data;
  const [sheet, setSheet] = useState<'transcript' | 'instructions' | null>(null);

  const entry = mandates.data?.find((m) => m.payload.id === deal.mandate_id && m.payload.version === deal.mandate_version);
  const newer = !!mandates.data?.some((m) => m.payload.id === deal.mandate_id && m.payload.version > deal.mandate_version);
  const clauses = useMemo(() => entry?.payload.clauses ?? [], [entry]);
  const readings = useMemo(() => readClauses(clauses, deal, {
    asks: need?.clause && need.clause.mandate_id === deal.mandate_id ? need.clause.number : null,
    house: cp.house,
    rounds: disp.band ? { used: disp.band.rounds_used, max: disp.band.max_rounds } : null,
  }), [clauses, deal, need, cp.house, disp.band]);

  const mirrored = mirrorStrip(deal, { needsYou: !!need, reconciliation: evidence?.reconciliation ?? null });
  // While PayPal is being asked, the current step reads "Checking", not the state Rust last saw.
  const check = evidence?.money_check ?? need?.money_check ?? null;
  const strip = check ? { ...mirrored, steps: mirrored.steps.map((s) => (s.status === 'cur' ? { ...s, label: DEAL_FIGS.checking } : s)) } : mirrored;
  const withdrawable = mayWithdraw(deal, need) && !check;
  const deadline = need?.deadline ?? disp.deadline;
  const them = cp.name.split(' · ')[0] ?? cp.name;
  const latest = useMemo(() => (tr.data ?? []).reduce<TranscriptStep | null>((a, s) => (!a || s.seq > a.seq ? s : a), null), [tr.data]);
  const bandReading = deal.kind === 'haggle' ? (readings.find((r) => r.n === 4)?.reading ?? null) : null;
  const checks = ruleChecks(readings);
  const badge = rulesBadge(checks);
  const answer = dealAnswer(deal, { need, them, latest, band: bandReading, mayWithdraw: withdrawable, check });
  const houseRecord = evidence?.house_record ? houseRecordWord(evidence.house_record) : null;
  const pf = pairingFact(cp.entry);
  const refs = heldRefs(deal).length;
  const offersUsed = deal.kind === 'haggle' && disp.band ? DEAL_WHO.offersUsed(disp.band.rounds_used, disp.band.max_rounds) : null;
  const ended = isTerminal(deal);
  const atFloor = acceptedAtFloorLine(deal, disp.band, tr.data);

  const cards: LensCard[] = [
    {
      id: 'story', label: DEAL_CARD.story,
      value: tr.data ? (tr.data.length ? DEAL_CARD.messages(tr.data.length) : deal.kind === 'haggle' && isLive(deal) ? DEAL_CARD.noOffers : DEAL_CARD.noMessages) : null,
      note: tr.data ? latestText(tr.data, them) ?? undefined : undefined,
      view: {
        title: DEAL_CARD.storyView, sub: DEAL_CARD.storySub,
        render: () => <StoryPart deal={deal} steps={tr.data} error={tr.error} clauses={clauses} theirName={cp.name} them={them} latest={latest} title={disp.title} />,
      },
    },
    {
      id: 'rules', label: DEAL_CARD.rules,
      value: mandates.data ? (!entry ? DEAL_CARD.rulesGone : badge ? badge.text : checks.some((c) => c.state !== 'unknown') ? DEAL_CARD.rulesAll : DEAL_CARD.rulesNone) : null,
      note: entry ? rulesName(entry.agent) : undefined,
      view: {
        title: DEAL_CARD.rulesView, sub: DEAL_CARD.rulesSub,
        render: () => <RulesView deal={deal} readings={readings} mandate={{ entry, newer, error: mandates.error, loading: !mandates.data && !mandates.error }} onRules={() => nav.place('rules')} />,
      },
    },
    {
      id: 'who', label: DEAL_CARD.who, value: <WhoChip name={cp.name} />, note: pf.text,
      view: { title: DEAL_CARD.whoView, sub: DEAL_CARD.whoSub, render: () => <WhoView deal={deal} cp={cp} offersUsed={offersUsed} /> },
    },
    {
      id: 'proof', label: DEAL_CARD.proof,
      value: refs ? DEAL_CARD.proofHas(refs) : deal.state === 'REFUSED' ? DEAL_CARD.proofNever : DEAL_CARD.proofNone,
      note: DEAL_CARD.proofNote, chip: houseRecord?.warns ? houseRecord.text : undefined, chipTone: houseRecord?.tone,
      view: { title: DEAL_CARD.proofView, sub: DEAL_CARD.proofSub, render: () => <ProofView deal={deal} band={disp.band} onFresh={(e) => setFresh({ id: deal.id, e })} fresh={fresh && fresh.id === deal.id ? fresh.e : null} /> },
    },
  ];

  // Latest on this deal, while no view is open: its last signed messages and ledger moments, newest
  // first, from the conversation the page already read (no read of its own). A row opens the story.
  const sheetView = useSheetView();
  const toStory = () => sheetView?.open('story', 'story');
  const moments = tr.data ? timelineRows(tr.data, deal) : [];
  const onDeal: LatestProps | undefined = tr.data ? {
    title: LATEST_OF.deal, total: moments.length,
    rows: moments.slice(0, MAX_ROWS).map((r) => {
      const said = r.kind === 'env' ? (() => { const w = stepWords(r.step, them); return `${w.who} ${w.verb}${r.step.price ? ` ${formatMoney(r.step.price)}` : ''}`; })() : r.text;
      return { key: r.key, label: `${clockLabel(r.at)} · ${said}`, onOpen: toStory, node: <span className="lt-line"><span className="lt-when num">{clockLabel(r.at)}</span><span className="lt-said">{said}</span></span> };
    }),
    seeAll: sheetView ? { onOpen: toStory } : undefined,
    // Where it stands, in numbers from the signed terms (the story view's own facts, no read).
    facts: standingFacts(deal, disp.band, latest, them, null, tr.data).map((f) => [f.k, f.v] as const),
  } : undefined;
  // And the other deals with the same counterparty, newest first (from the ledger the window holds).
  const allDeals = useDeals().data;
  const others = useMemo(() => (allDeals ?? []).filter((d) => d.counterparty === deal.counterparty && d.id !== deal.id)
    .sort((a, b) => (b.updated_at ?? b.created_at ?? 0) - (a.updated_at ?? a.created_at ?? 0)), [allDeals, deal.counterparty, deal.id]);
  const withThem: LatestProps | null = others.length ? {
    title: LATEST_OF.withThem(houseWords(them)), total: others.length,
    rows: others.slice(0, MAX_ROWS).map((d) => ({ key: d.id, label: `${display(d).title}, ${OPEN_THE_DEAL}`, onOpen: () => nav.deal(d.id), node: <DealRow deal={d} who={cp.name} /> })),
  } : null;
  const strips = [onDeal, withThem].filter((x): x is LatestProps => !!x);

  const consequence = !need && !ended && isLive(deal) && disp.on_silence
    ? <p className="dv-consequence"><Silence text={silenceWords(disp.on_silence)} deadline={deadline} /></p> : null;

  return (
    <PlaceFrame root="ar-deal" place="deal" tone={MODULE[module].cssVar}
      kicker={<>{MODULE[module].name} · {deal.side === 'buyer' ? DEAL_SIDE.buyer : DEAL_SIDE.seller} · {kindWord(deal.kind)} · <span className="dv-kwho">{deal.side === 'buyer' ? DEAL_KICKER.buyingFrom(houseWords(them)) : DEAL_KICKER.sellingTo(houseWords(them))}</span></>}
      answer={disp.title}
      sub={<span className={`dv-answer tone-${answer.tone}`}><b>{answer.title}</b>{answer.sub ? <> {answer.sub}</> : null}</span>}
      aside={<Summary deal={deal} strip={strip} deadline={deadline} check={check} />}
      action={<PageActions deal={deal} label={disp.label} entryAgent={entry?.agent ?? null} needs={!!need} onSheet={setSheet}
        onWatch={worthWatching(deal, disp.band) ? () => { watchTable(deal.id); nav.go({ level: 'module', module: 'tables', view: 'watch' }); } : null} />}
      lead={(
        <div className="dv-lead">
          {disp.fallback ? <Hint>{DEAL_ACT.fallback}</Hint> : null}
          <StateStrip strip={strip} />
          {/* What the owner was shown (its own read of the record) takes the last turn (stagger.tsx). */}
          {ended ? <Reveal wave={3}><ShownStrip deal={deal} /></Reveal> : null}
          {atFloor ? <p className="dv-consequence">{atFloor}</p> : null}
          {consequence}
          <DealDecision deal={deal} need={need} canWithdraw={withdrawable} theirName={them} them={them} readings={readings} deadline={deadline} />
        </div>
      )}
      cards={cards} latest={strips} childrenWave={0}>
      {sheet === 'transcript' ? (
        <TranscriptSheet deal={deal} label={disp.label} steps={tr.data} error={tr.error} band={disp.band} theirName={cp.name} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'instructions' ? <InstructionsFor dealId={deal.id} onClose={() => setSheet(null)} /> : null}
    </PlaceFrame>
  );
}

/** The story view with the numbers that matter (a failed renewal's numbers come from the rescue
 *  book, read only when this view opens on a rescue deal). */
function StoryPart({ deal, steps, error, clauses, theirName, them, latest, title }: {
  deal: Deal; steps: TranscriptStep[] | undefined; error: WalletError | null; clauses: readonly Clause[];
  theirName: string; them: string; latest: TranscriptStep | null; title: string;
}) {
  const { display } = useWorldSelector(sel, same);
  const rescue = useQuery('rescue_book', null, { enabled: deal.kind === 'rescue', refreshOn: ['deal:changed'] });
  const offer = deal.kind === 'rescue' ? rescue.data?.cases.find((v) => v.deal_id === deal.id)?.offer ?? null : null;
  const facts = standingFacts(deal, display(deal).band, latest, them, offer, steps);
  return <StoryView deal={deal} steps={steps} error={error} clauses={clauses} theirName={theirName} facts={facts} factsTitle={deal.kind === 'haggle' ? DEAL_STORY.factsHaggle : DEAL_STORY.factsOther} title={title} />;
}

/** Start agent (haggles at the table), Watch it (a haggle replayed), Details and Export record: the page's quiet actions. */
function PageActions({ deal, label, entryAgent, needs, onSheet, onWatch }: { deal: Deal; label: string; entryAgent: string | null; needs: boolean; onSheet: (s: 'transcript' | 'instructions') => void; onWatch: (() => void) | null }) {
  const runs = useRuns().data;
  const [facts, setFacts] = useState<HTMLElement | null>(null);
  const run = actingRun(runs, deal.id);
  return (
    <>
      <AgentAction deal={deal} label={label} needs={needs} />
      {onWatch ? <Btn sm kind="plain" onClick={onWatch} title={TABLES_WATCH.watchItTitle}>{TABLES_WATCH.watchIt}</Btn> : null}
      <Btn sm kind="plain" aria-expanded={!!facts} onClick={(e) => { const t = e.currentTarget; setFacts((x) => (x ? null : t)); }}>{DEAL_ACT.details}</Btn>
      <Btn sm onClick={() => onSheet('transcript')}>{DEAL_ACT.export}</Btn>
      {facts ? (
        <Popover anchor={facts} onClose={() => setFacts(null)} title={DEAL_ACT.detailsTitle} className="dv-pop ar-deal-sheet">
          <Kv items={[
            [DEAL_DETAILS.deal, <span className="mono">{label} · {shortId(deal.id, 6, 4)}</span>],
            [DEAL_DETAILS.exact, <span className="mono">{deal.state.replace(/_/g, ' ').toLowerCase()}</span>],
            [DEAL_DETAILS.rules, <>{entryAgent ? rulesName(entryAgent) : DEAL_DETAILS.rules} · {DEAL_DETAILS.version(deal.mandate_version)} <span className="mono dim">{shortId(deal.mandate_id)}</span></>],
            run ? [DEAL_DETAILS.agent, <><span className="mono">{run.engine}</span> <RunBadge run={run} /></>] : null,
            run ? [INSTRUCTIONS, <InstructionsValue run={run} onOpen={() => { setFacts(null); onSheet('instructions'); }} />] : null,
            [DEAL_DETAILS.record, <span className="mono">{shortHash(deal.transcript_head)}</span>],
          ]} />
        </Popover>
      ) : null}
    </>
  );
}

function InstructionsFor({ dealId, onClose }: { dealId: string; onClose: () => void }) {
  const run = actingRun(useRuns().data, dealId);
  if (!run?.playbook) return null;
  return <InstructionsSheet playbook={run.playbook} onClose={onClose} />;
}

/** Start a mandate-bound agent run (haggles at the table), or show the one running. While the deal
 *  needs the owner, the gold Review is the one decision on the page: this stays quiet. */
function AgentAction({ deal, label, needs }: { deal: Deal; label: string; needs: boolean }) {
  const s = useSettings().data;
  const runs = useRuns().data;
  const toast = useToast();
  const start = useMutation('agent_start');
  if (!canStartAgent(deal)) return null;
  const paused = !!s?.agents_paused;
  const run = (runs ?? []).find((r) => r.deal_id === deal.id && (r.state === 'running' || r.state === 'starting'));
  if (run) return <><Chip tone="ok" title={DEAL_ACT.agentRunTitle(run.engine)}>{DEAL_ACT.agentRun(run.state)}</Chip><RunBadge run={run} /></>;
  const ended = lastFinishedRun(runs, deal.id);
  return (
    <>
      {ended ? <Chip tone={ended.state === 'clean' ? 'ok' : ended.state === 'failed' ? 'gold' : 'line'}>{DEAL_ACT.lastRun[ended.state as 'clean' | 'failed' | 'cancelled']}</Chip> : null}
      <Btn sm kind={needs ? undefined : 'primary'} disabled={paused || start.pending} title={paused ? DEAL_ACT.agentsPausedTitle : DEAL_ACT.startAgentTitle}
        onClick={async () => { const r = await start.run({ deal_id: deal.id }); if (r) toast(DEAL_ACT.agentIs(r.state, label), 'ok'); }}>
        {paused ? DEAL_ACT.agentsPaused : DEAL_ACT.startAgent}
      </Btn>
      {start.error ? <WalletNotice error={start.error} what={NOTICE_WHAT.agent} /> : null}
    </>
  );
}
