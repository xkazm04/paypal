// Layer 2 · deal detail as a story, read top to bottom: the header (title, big amount, status, time
// left, Details), the five milestones, the answer in one sentence, the one decision (if the deal
// needs you), then four plain sections: What happened · Your rules · Who you're dealing with ·
// Proof from PayPal. Every explanation is layer 2 (Popover / Sheet).
// One decision here (review in the approval window, or withdraw); there is never a money button.
import { useMemo, useState, type KeyboardEvent } from 'react';
import type { Deal } from '@bindings/Deal';
import type { DealEvidence } from '@bindings/DealEvidence';
import type { TranscriptStep } from '@bindings/TranscriptStep';
import { shortHash, shortId } from '../../lib/format';
import { useMutation, useQuery } from '../../lib/hooks';
import { RunBadge, WalletNotice } from '../../shared/honesty';
import { kindWord, rulesName } from '../../lib/words';
import { Btn, Chip, Hint, Kv, PageHead, Popover } from '../../shared/ui';
import { canStartAgent } from './logic';
import { mc, useCpLookup, useToast } from './ui';
import { useWorld } from './world';
import { WhatHappened, WhoYouDealWith, YourRules } from './deal/Columns';
import { DealStory, StateStrip, Summary } from './deal/Decision';
import { EvidenceSheet, ProofPanel, TranscriptSheet, type EvidenceKind } from './deal/Evidence';
import { mayWithdraw, mirrorStrip, readClauses } from './deal/model';
import { ruleChecks, rulesBadge, standingFacts } from './deal/story';
import { WhoDecided } from './deal/WhoDecided';
import { shortTitle } from './home/model';
import './deal.css';

type Tab = 'happened' | 'rules' | 'who' | 'proof';
const TABS: readonly { key: Tab; label: string }[] = [
  { key: 'happened', label: 'What happened' },
  { key: 'rules', label: 'Your rules' },
  { key: 'who', label: 'Who you’re dealing with' },
  { key: 'proof', label: 'Proof from PayPal' },
];

export function DealView({ deal }: { deal: Deal; onModule?: () => void }) {
  const w = useWorld();
  const disp = w.display(deal);
  const need = w.needOf(deal.id);
  const module = w.moduleOfDeal(deal);
  const cp = useCpLookup()(deal.counterparty);

  const tr = useQuery('deal_transcript', { deal_id: deal.id }, { refreshOn: ['deal:changed'] });
  const evq = useQuery('deal_evidence', { deal_id: deal.id }, { refreshOn: ['deal:changed', 'receipt:created'] });
  const mandates = useQuery('mandate_list', null, { refreshOn: ['settings:changed'] });
  const [fresh, setFresh] = useState<{ id: string; e: DealEvidence } | null>(null);
  const evidence = fresh && fresh.id === deal.id ? fresh.e : evq.data;

  const [tabAt, setTabAt] = useState<{ id: string; tab: Tab }>({ id: deal.id, tab: 'happened' });
  const tab: Tab = tabAt.id === deal.id ? tabAt.tab : 'happened';
  const [sheet, setSheet] = useState<EvidenceKind | 'transcript' | null>(null);
  const [facts, setFacts] = useState<HTMLElement | null>(null);

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
  const pending = evidence?.money_check ?? need?.money_check ?? null;
  const strip = pending ? { ...mirrored, steps: mirrored.steps.map((s) => (s.status === 'cur' ? { ...s, label: 'Checking' } : s)) } : mirrored;
  // A payment step being checked with PayPal (from the deal's evidence, or its card).
  const check = pending;
  const withdrawable = mayWithdraw(deal, need) && !check;
  const deadline = need?.deadline ?? disp.deadline;
  const run = (w.runs.data ?? []).find((r) => r.deal_id === deal.id);
  const them = cp.name.split(' · ')[0] ?? cp.name;
  const latest = useMemo(() => (tr.data ?? []).reduce<TranscriptStep | null>((a, s) => (!a || s.seq > a.seq ? s : a), null), [tr.data]);
  const bandReading = deal.kind === 'haggle' ? (readings.find((r) => r.n === 4)?.reading ?? null) : null;
  const badge = rulesBadge(ruleChecks(readings));
  const nFacts = standingFacts(deal, disp.band, latest, them);

  const go = (t: Tab) => setTabAt({ id: deal.id, tab: t });
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.key === tab);
    const n = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    if (!n) return;
    go(n.key);
    requestAnimationFrame(() => document.getElementById(`dv-tab-${n.key}`)?.focus());
  };

  return (
    <div style={mc(module)} className="dealview">
      <PageHead focusKey={deal.id} title={disp.title}
        sub={<>{deal.side === 'buyer' ? 'You’re buying' : 'You’re selling'} · {kindWord(deal.kind)} · {disp.label}</>}
        actions={<>
          <AgentAction deal={deal} label={disp.label} />
          <Btn sm kind="plain" onClick={(e) => { const t = e.currentTarget; setFacts((x) => (x ? null : t)); }}>Details</Btn>
          <Btn sm onClick={() => setSheet('transcript')}>Export record</Btn>
        </>} />
      {disp.fallback ? <Hint>Some names couldn’t be loaded, so short ids are shown.</Hint> : null}
      {facts ? (
        <Popover anchor={facts} onClose={() => setFacts(null)} title="Deal details" className="dv-pop">
          <Kv items={[
            ['Deal', <span className="mono">{disp.label} · {shortId(deal.id, 6, 4)}</span>],
            ['Exact state', <span className="mono">{deal.state.replace(/_/g, ' ').toLowerCase()}</span>],
            ['Rules', <>{entry ? rulesName(entry.agent) : 'Rules'} · version {deal.mandate_version} <span className="mono dim">{shortId(deal.mandate_id)}</span></>],
            run ? ['Agent app', <><span className="mono">{run.engine}</span> <RunBadge run={run} /></>] : null,
            ['Record', <span className="mono">{shortHash(deal.transcript_head)}</span>],
          ]} />
        </Popover>
      ) : null}

      <Summary deal={deal} strip={strip} deadline={deadline} check={check} />
      <StateStrip strip={strip} />
      <DealStory deal={deal} need={need} canWithdraw={withdrawable} theirName={them} them={them} latest={latest} band={bandReading}
        readings={readings} deadline={deadline} check={check} />

      <div className="dv-tabs" role="tablist" aria-label="About this deal" onKeyDown={onTabKey}>
        {TABS.map((t) => (
          <button key={t.key} id={`dv-tab-${t.key}`} type="button" role="tab" aria-selected={tab === t.key} aria-controls="dv-panel"
            tabIndex={tab === t.key ? 0 : -1} className="dv-tab" onClick={() => go(t.key)}>
            {t.label}
            {t.key === 'rules' && badge ? <Chip tone={badge.tone}>{badge.text}</Chip> : null}
          </button>
        ))}
      </div>
      <div id="dv-panel" role="tabpanel" aria-labelledby={`dv-tab-${tab}`} className="dv-tabpanel">
        {tab === 'happened' ? (
<>
          <WhatHappened deal={deal} steps={tr.data} error={tr.error} clauses={clauses} theirName={cp.name}
            facts={nFacts} factsTitle={deal.kind === 'haggle' ? 'Where it stands' : 'The numbers'} />
          <WhoDecided deal={deal} title={shortTitle(disp.title)} />
          </>
        ) : tab === 'rules' ? (
          <YourRules deal={deal} readings={readings} mandate={{ entry, newer, error: mandates.error, loading: !mandates.data && !mandates.error }} />
        ) : tab === 'who' ? (
          <WhoYouDealWith deal={deal} cp={cp} offersUsed={deal.kind === 'haggle' && disp.band ? `${disp.band.rounds_used} of ${disp.band.max_rounds} used` : null} />
        ) : (
          <ProofPanel deal={deal} ev={{ data: evidence, error: evq.error }} band={disp.band} onOpen={setSheet} />
        )}
      </div>

      {sheet === 'transcript' ? (
        <TranscriptSheet deal={deal} label={disp.label} steps={tr.data} error={tr.error} band={disp.band} theirName={cp.name} onClose={() => setSheet(null)} />
      ) : sheet ? (
        <EvidenceSheet kind={sheet} deal={deal} ev={{ data: evidence, error: evq.error }} band={disp.band}
          onFresh={(e) => setFresh({ id: deal.id, e })} onClose={() => setSheet(null)} />
      ) : null}
    </div>
  );
}

/** Start a mandate-bound agent run (haggles at the table), or show the one running. */
function AgentAction({ deal, label }: { deal: Deal; label: string }) {
  const w = useWorld();
  const toast = useToast();
  const start = useMutation('agent_start');
  if (!canStartAgent(deal)) return null;
  const paused = !!w.settings.data?.agents_paused;
  const run = (w.runs.data ?? []).find((r) => r.deal_id === deal.id && (r.state === 'running' || r.state === 'starting'));
  if (run) return <><Chip tone="ok" title={`Run ${shortId(run.run)} on ${run.engine}`}>Agent {run.state}</Chip><RunBadge run={run} /></>;
  return (
    <>
      <Btn sm kind="primary" disabled={paused || start.pending} title={paused ? 'All agents are paused; resume them in Settings' : 'Let your agent bargain for this deal, inside your rules'}
        onClick={async () => { const r = await start.run({ deal_id: deal.id }); if (r) toast(<>Your agent is <b>{r.state}</b> on {label}</>, 'ok'); }}>
        {paused ? 'Agents paused' : 'Start agent'}
      </Btn>
      {start.error ? <WalletNotice error={start.error} what="Agent" /> : null}
    </>
  );
}
