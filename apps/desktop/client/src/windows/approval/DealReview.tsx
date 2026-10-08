// Deal review mode: the approval moment (docs/design/the-table.html §10.3), as The Diff
// (prototype/pages/approval/variant-3): "is this exactly what I signed?" answered as two columns,
// your side and the side being asked, with a relation gutter per row. After the browser hand-off
// the same table compares what you approved with what PayPal and the seller report.
//
// CHECKING → READY → (LOCKED) → IN BROWSER → APPROVED (polled) → SELLER-ATTESTED → RECEIPTED,
// or MISMATCH / EXPIRED / WITHDRAWN / SHIELD HOLD. Rust's immutable summary is the only input;
// every success line reads the Deal Rust returned, never an optimistic money state. gating.ts only
// narrows Rust's flags. The checklist is Rust's (ApprovalSummary.checks), rendered verbatim; a
// failed line disables the money buttons and every decision carries its checks_hash. Enter never releases money: the window
// focuses its heading and money buttons ignore Enter.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { ApprovalSummary } from '@bindings/ApprovalSummary';
import type { Deal } from '@bindings/Deal';
import type { Module } from '@bindings/Module';
import type { RescueLever } from '@bindings/RescueLever';
import { WalletError, toWalletError } from '../../lib/contract';
import { useCounterparties, useDealDisplay } from '../../lib/display';
import { formatMoney, nowUnix, shortId } from '../../lib/format';
import { houseWords, RESCUE_APPROVE_DOES, RESCUE_REPLAY_NOT_COUNTED, SUMMARY_CHANGED, reasonWords, subscriberName, reconWord, receiptWord, shieldRuleWord, silenceWords } from '../../lib/words';
import { useEvent, useNow, usePrefersReducedMotion, useQuery } from '../../lib/hooks';
import { backend } from '../../lib/runtime';
import { MODULES } from '../../shared/modules';
import { Countdown, WalletNotice } from '../../shared/honesty';
import { AnswerBar, Btn, Field, HoldButton, Popover, Sheet, layerCount, useFocusRescue, useToast } from '../../shared/ui';
import { MarkIcon } from './review/Parts';
import { BandAdjust } from './BandAdjust';
import { decisionArgs, deriveGates, isLocked, isTerminal, namesMatch, ownerAcceptArgs, type Gate, type Gates } from './gating';
import { buildStrip, dealTotal, derivePhase, stateWord, type Phase } from './model';
import { buildDiff, buildEvidence, lastAmount, type DiffRow } from './review/diff';
import { WalletChecks, checksLine } from './review/Checks';
import { DetailsSheet, RowDetail } from './review/Details';
import { DiffTable, Due, MarketLine, MarketTrack, ReviewBar, ROW_SELECTOR, StateChip, StateList, TwinHeader, type RowSet } from './review/Parts';
import { nextSteps } from './review/next';
import { NextPath, WhyNote } from './review/Round2';
import { stoppedText, summarySentence, waitingText, type Intent } from './review/says';
import { answerWhy, askAboveOf, highPriceWord, type WhyFacts } from './review/why';
import { useHandoff } from './selection';
import { useSession } from './session';
import { HelloGlyph, LockGlyph } from './ui';
import './approval.css';

type DecisionCmd = 'deal_owner_accept' | 'deal_countersign' | 'deal_capture' | 'deal_void' | 'shield_release' | 'rescue_approve';

const POLL_IN_BROWSER_MS = 3000;
const POLL_IDLE_MS = 10000;
const LOCK_TEXT =
  'Like PayPal, the wallet asks again after 15 quiet minutes before it approves, opens PayPal, pays, releases or signs anything. You can still read everything here, and money stays where it is until you unlock.';

const KIND_MODULE: Record<Deal['kind'], Module> = { haggle: 'tables', purchase: 'spend', shop_order: 'counter', rescue: 'rescue', invoice: 'book' };

type Pop = { key: string; anchor: HTMLElement };

const LEVER_NAME: Record<RescueLever, string> = { DISCOUNT_THIS_CYCLE: 'the discount on this cycle', PAUSE: 'a pause', RETRY_AFTER_FIX: 'a retry after they fix their card', DOWNGRADE: 'a cheaper plan' };

export function DealReview({ dealId, seed }: { dealId: string; seed: ApprovalSummary | null }) {
  const s = useSession();
  const handoff = useHandoff();
  const toast = useToast();
  const reduced = usePrefersReducedMotion();
  const now = useNow();
  const [summary, setSummary] = useState<ApprovalSummary | undefined>(seed ?? undefined);
  const [loadError, setLoadError] = useState<WalletError | null>(null);
  const [lastRead, setLastRead] = useState<number | null>(null);
  const [inBrowser, setInBrowser] = useState(false);
  const [typed, setTyped] = useState('');
  const [failure, setFailure] = useState<{ what: string; error: WalletError } | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [details, setDetails] = useState(false);
  const [pop, setPop] = useState<Pop | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [closeNote, setCloseNote] = useState<string | null>(null);
  // Bumped when the wallet answers that the summary changed: the CHECKING reveal runs again.
  const [revealRun, setRevealRun] = useState(0);
  const headRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLElement>(null);
  // A decided money button unmounts while it has focus: keyboard and screen-reader users land on
  // the heading (the outcome is announced by its status line), never on the page body.
  useFocusRescue(headRef);

  // ---- data: subscribe, then fetch; events are projections, so refetch rather than patch ----
  const refetch = useCallback(async () => {
    try {
      const r = await backend().invoke('approval_summary', { deal_id: dealId });
      setSummary(r);
      setLoadError(null);
      setLastRead(nowUnix());
    } catch (e) {
      setLoadError(toWalletError(e));
    }
  }, [dealId]);
  useEvent('approval:summary', (p) => {
    if (p.deal.id === dealId) {
      setSummary(p);
      setLastRead(nowUnix());
    }
  });
  useEffect(() => {
    void refetch();
  }, [refetch, s.settings]);

  const deal = summary?.deal;
  const terminal = deal ? isTerminal(deal.state) : false;
  useEffect(() => {
    if (!deal || terminal) return;
    const t = setInterval(() => void refetch(), inBrowser ? POLL_IN_BROWSER_MS : POLL_IDLE_MS);
    return () => clearInterval(t);
  }, [deal, terminal, inBrowser, refetch]);

  const mandates = useQuery('mandate_list', null, { refreshOn: ['settings:changed'] });
  const attention = useQuery('attention_list', null, { refreshOn: ['settings:changed'] });
  const transcriptQ = useQuery('deal_transcript', { deal_id: dealId });
  const display = useDealDisplay(deal);
  const lookup = useCounterparties();
  const refetchAttention = attention.refetch;
  const refetchTranscript = transcriptQ.refetch;
  useEffect(() => {
    void refetchAttention();
    void refetchTranscript();
  }, [deal?.state, deal?.shield, refetchAttention, refetchTranscript]);

  const attn = attention.data?.items.find((i) => i.deal_id === dealId);
  const cp = deal ? lookup(deal.counterparty) : undefined;
  // A subscriber has no wallet: a rescue names them by their subscription.
  const cpName = cp?.known ? cp.name : attn?.counterparty ? houseWords(attn.counterparty) : (deal ? subscriberName(deal.counterparty) ?? `key ${shortId(deal.counterparty)}` : '');
  const mandate = useMemo(() => {
    if (!deal || !mandates.data) return undefined;
    // A set the wallet now refuses (refusal) is listed but not in force for this deal.
    const same = mandates.data.filter((m) => m.payload.id === deal.mandate_id && !m.refusal);
    if (!same.length) return null;
    return same.find((m) => m.payload.version === deal.mandate_version) ?? undefined;
  }, [deal, mandates.data]);
  const minute = Math.floor(now / 60);
  const clauseNumber = attn?.clause?.number ?? null;

  // The checklist is the wallet's, verbatim: it gates the money buttons and its hash goes back
  // with every decision. The window composes no check line of its own.
  const checks = summary?.checks ?? [];

  // ---- gates (first pass: which controls exist; visibility never depends on a check) ----
  const locked = summary ? isLocked({ summary, settingsLocked: s.settingsLocked, lockedByError: s.lockedByError }) : s.settingsLocked || s.lockedByError;
  const expectedName = cp?.known ? cp.name : deal?.counterparty ?? null;
  const gateCtx = summary
    ? { summary, settingsLocked: s.settingsLocked, lockedByError: s.lockedByError, tokenReady: s.tokenReady, typedName: typed, expectedName }
    : null;
  const ownerAcceptVisible = gateCtx ? deriveGates(gateCtx).ownerAccept.visible : false;

  // ---- the diff ----
  const transcript = transcriptQ.data;
  const diff = useMemo(
    () =>
      summary
        ? buildDiff({
            summary,
            mandate,
            clauseNumber,
            counterparty: { name: cpName, known: !!cp?.known, house: cp?.house ?? false, firstSeen: cp?.entry?.first_seen ?? null },
            band: display?.band ?? null,
            transcript,
            ownerAccept: ownerAcceptVisible,
            handedOff: inBrowser,
            now: minute * 60,
          })
        : null,
    [summary, mandate, clauseNumber, cpName, cp?.known, cp?.house, cp?.entry?.first_seen, display?.band, transcript, ownerAcceptVisible, inBrowser, minute],
  );
  const evidence = summary ? buildEvidence({ summary, inBrowser, counterparty: cpName, transcript }) : null;
  const rowCount = diff?.rows.length ?? 0;

  // ---- CHECKING: reveal the rows as the wallet reports them (instant with reduced motion) ----
  const hasSummary = !!summary;
  useEffect(() => {
    if (!hasSummary) return;
    if (reduced) {
      setRevealed(99);
      return;
    }
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setRevealed(i);
      if (i > 7) clearInterval(t);
    }, 120);
    return () => clearInterval(t);
  }, [hasSummary, reduced, revealRun]);
  const allRevealed = revealed >= Math.max(rowCount, checks.length);

  const gates: Gates | null = gateCtx ? deriveGates(gateCtx) : null;
  const phase: Phase = derivePhase(summary, { locked, inBrowser, revealed: allRevealed });
  const busy = s.pending !== null;

  // Leaving AWAITING_APPROVAL ends the in-browser wait (the poll saw it, not a redirect).
  useEffect(() => {
    if (inBrowser && deal && deal.state !== 'AWAITING_APPROVAL') setInBrowser(false);
  }, [inBrowser, deal]);
  // Focus the heading (or the body before the summary), never a money button.
  useEffect(() => {
    (headRef.current ?? bodyRef.current)?.focus({ preventScroll: true });
  }, [dealId, hasSummary]);

  // W asks to withdraw (the safe direction); never while typing or with a sheet / popover open.
  const withdrawVisible = !!gates?.withdraw.visible;
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'w' && e.key !== 'W') return;
      if (e.ctrlKey || e.metaKey || e.altKey || layerCount() > 0) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (!withdrawVisible) return;
      e.preventDefault();
      setConfirmWithdraw(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [withdrawVisible]);

  const openPop = (key: string, anchor: HTMLElement) => setPop((p) => (p && p.key === key ? null : { key, anchor }));

  // ---- actions ----
  const decide = async (cmd: DecisionCmd, what: string) => {
    if (!summary) return;
    setFailure(null);
    setOutcome(null);
    // Owner ACCEPT binds the exact counter Rust reported; every other decision the terms only.
    const args = cmd === 'deal_owner_accept' ? ownerAcceptArgs(summary) : decisionArgs(summary);
    if (!args) {
      setFailure({ what, error: new WalletError({ code: 'INVALID', message: 'their latest offer hasn’t arrived yet' }) });
      return;
    }
    const r = await s.call<DecisionCmd>(cmd, args, true);
    if (r.ok) setOutcome(outcomeText(cmd, r.value, cpName));
    else setFailure({ what: stale(r.error) ? 'Nothing was done' : what, error: r.error });
    if (cmd === 'shield_release' && r.ok) setTyped('');
    await refetch();
  };
  const openPaypal = async () => {
    if (!summary) return;
    setFailure(null);
    setOutcome(null);
    const r = await s.call('open_paypal_in_browser', decisionArgs(summary), true);
    if (r.ok) {
      setInBrowser(true);
      toast('PayPal opened in your browser', 'gold');
    } else setFailure({ what: stale(r.error) ? 'Nothing was done' : 'PayPal was not opened', error: r.error });
    await refetch();
  };
  // The wallet refused because the checklist changed since it was shown: show the new one (the
  // refetch after every call reads it) and run the reveal again so the change is seen.
  const stale = (e: WalletError): boolean => {
    if (e.message !== SUMMARY_CHANGED) return false;
    setRevealRun((n) => n + 1);
    return true;
  };
  // After the hand-off the owner may close this window; the Tumbler keeps the hand-off. Only the
  // real shell has a window to close (the browser preview just keeps showing IN BROWSER).
  const closeWindow = async () => {
    setCloseNote(null);
    if (backend().kind !== 'tauri') {
      setCloseNote('Preview only. In the app this closes the window; the mini window keeps watching PayPal for you.');
      return;
    }
    try {
      await getCurrentWindow().close();
    } catch {
      setCloseNote('This window stayed open. Close it from its title bar; nothing changes for the deal.');
    }
  };
  const withdraw = async () => {
    setFailure(null);
    setOutcome(null);
    setConfirmWithdraw(false);
    // Withdraw needs no unlock and no capability: it only moves toward the default.
    const r = await s.call('deal_withdraw', { deal_id: dealId });
    if (!r.ok) setFailure({ what: 'Not withdrawn', error: r.error });
    else toast('Withdrawn. No money moved.', 'ok');
    await refetch();
  };
  // Enter never releases money: a focused money button ignores it (Space or a click still work).
  const guardEnter = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      toast('For safety, Enter never approves money. Click the button, or press Space on it.');
    }
  };
  // The hold button ignores Enter itself; this only says why (a click does nothing either: hold it).
  const guardEnterHold = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter') toast('For safety, Enter never approves money. Press and hold the button, or hold Space on it.');
  };

  // ---- render: before the summary ----
  if (!summary || !diff || !gates) {
    return (
      <div className="aw dr phase-checking">
        <ReviewBar module={null} label={null} mode={undefined} />
        <main className="dr-body" ref={bodyRef} tabIndex={-1} aria-label="Checking the signed deal">
          <div className="dr-head">
            <h1 className="dr-h">Checking <span className="q">· reading the agreed deal</span></h1>
          </div>
          <div className="dr-twin">
            <div className="tw l"><span className="twk">You agreed</span><span className="tw-amt skeleton">$ ———</span></div>
            <div className="tw-op wait" aria-hidden="true"><MarkIcon mark="…" className="big" /><span className="w">checking</span></div>
            <div className="tw r"><span className="twk">Being asked</span><span className="tw-amt skeleton">$ ———</span></div>
          </div>
          {loadError ? <WalletNotice error={loadError} what="This deal couldn’t be read" /> : <p className="dr-line dim">Reading the deal from your wallet…</p>}
        </main>
      </div>
    );
  }

  // ---- render: the review ----
  const d = summary.deal;
  const g = gates;
  const totalM = dealTotal(d);
  const total = formatMoney(totalM);
  const title = display?.title ?? d.terms.item_ref;
  const label = display?.label ?? shortId(d.id);
  const moduleKey = attn?.module ?? KIND_MODULE[d.kind];
  const moduleName = MODULES.find((m) => m.key === moduleKey)?.name ?? null;
  const deadline = display?.deadline ?? attn?.deadline ?? null;
  const rawSilence = attn?.on_silence ?? display?.on_silence ?? null;
  const silence = rawSilence ? silenceWords(rawSilence) : null;
  const steps = buildStrip(summary, phase, locked);
  const checking = phase === 'checking';
  const showLock = locked && (phase === 'locked' || phase === 'hold' || phase === 'ready' || phase === 'in_browser') && moneyRelevant(g);
  const decided = !!evidence || phase === 'done' || phase === 'stopped' || phase === 'waiting';
  const status = statusOf(phase, d, summary, total, cpName);
  const settle = lastAmount(transcript, 'SETTLE');
  const note = noteFor(phase, g, d, total, cpName);
  const approveCountdown = deadline ? <Countdown deadline={deadline} /> : null;
  const who = cpName.split(' · ')[0] || cpName;
  const heading = phase === 'mismatch' ? `Payment to ${who} stopped` : d.shield === 'HOLD' && !terminal ? `Unpause a payment to ${who}` : `${verb(d, diff.kind === 'accept')} ${who}`;
  // What the window asks of the owner, from which controls exist (visibility only; gating decides if they work).
  const act: Intent = g.ownerAccept.visible ? 'accept' : g.openPaypal.visible ? 'open' : g.capture.visible ? 'capture' : g.countersign.visible ? 'countersign' : g.rescue.visible ? 'rescue' : g.releaseHold.visible ? 'release' : null;
  const says = summarySentence({ kind: diff.kind, phase, deal: d, summary, who, total, settle, twin: diff.twin, act, inBrowser });
  // "Why?" and "What happens next": built from the same facts as the sentence above.
  const facts: WhyFacts = { phase, who, total, askAbove: askAboveOf(mandate), highPrice: highPriceWord(d), shieldRule: d.shield_rule ? shieldRuleWord(d.shield_rule).means : null };
  const answerWhyText = answerWhy({ ...facts, kind: diff.kind, act, deal: d, rows: diff.rows, twin: diff.twin, settle, unavailable: summary.unavailable_reason ? reasonWords(summary.unavailable_reason) : null });
  const path = nextSteps({ kind: diff.kind, phase, deal: d, summary, who, total, act });

  const mismatchDetail = phase === 'mismatch' ? (
    <>
      <p className="pop-p">
        {settle ? <>{who}’s payment request asks for <b className="money">{formatMoney(settle)}</b>, </> : <>{who}’s payment request doesn’t match, </>}
        but you agreed <b className="money">{total}</b>.
      </p>
      <p className="pop-p">
        So there is no PayPal button, and on purpose no “pay anyway”. If the price should change, it takes a new agreed deal, not a click here. The signed history is your proof: export it from this deal in The Table.
      </p>
    </>
  ) : null;

  const popContent = (key: string): { title: string; body: ReactNode } | null => {
    if (key.startsWith('row:')) {
      const [, set, id] = key.split(':') as [string, RowSet, string];
      const list = set === 'ev' ? evidence?.rows ?? [] : diff.rows;
      const row = list.find((r) => r.id === id);
      if (!row) return null;
      return { title: row.name, body: <RowDetail row={row} heads={set === 'ev' && evidence ? evidence.heads : diff.heads} /> };
    }
    switch (key) {
      case 'mkt': return { title: 'Market price', body: <MarketTrack deal={d} /> };
      case 'states': return { title: `Steps · ${label}`, body: <StateList steps={steps} countdown={approveCountdown} /> };
      case 'status': return status ? { title: status.title, body: <p className="pop-p">{status.body}</p> } : null;
      case 'mismatch': return { title: 'Amount didn’t match · no pay button', body: mismatchDetail };
      case 'lock': return { title: 'Why it’s locked', body: <p className="pop-p">{LOCK_TEXT}</p> };
      case 'what': return note ? { title: 'What this does', body: note.full } : null;
      case 'why': return summary.unavailable_reason ? { title: 'Note from your wallet', body: <p className="pop-p">{reasonWords(summary.unavailable_reason)}</p> } : null;
      default: return null;
    }
  };
  const popped = pop ? popContent(pop.key) : null;
  const openRow = (row: DiffRow, set: RowSet, el: HTMLElement) => openPop(`row:${set}:${row.id}`, el);
  const openKey = pop?.key.startsWith('row:') ? pop.key.slice(4) : null;
  // The answer's own Why? replaces a separate "Why ›" on a mismatch (kept only when there is no Why? text).
  const answerAction = phase === 'mismatch'
    ? answerWhyText ? null : <Btn kind="plain" sm onClick={(e) => openPop('mismatch', e.currentTarget)}>Why ›</Btn>
    : status ? <Btn kind="plain" sm onClick={(e) => openPop('status', e.currentTarget)}>What happened ›</Btn> : null;

  const tone = phase === 'mismatch' || phase === 'block' ? 'bad' : phase === 'hold' ? 'hold' : phase === 'done' ? 'ok' : showLock ? 'lock' : 'gold';

  return (
    <div className={`aw dr phase-${phase} t-${tone}`}>
      <ReviewBar module={moduleName} label={null} mode={d.mode} onDetails={() => { setPop(null); setDetails(true); }} />

      <main className="dr-body" ref={bodyRef} aria-labelledby="dr-h">
        <div className="dr-head">
          <h1
            id="dr-h"
            className="dr-h"
            ref={headRef}
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                const first = document.querySelector<HTMLButtonElement>(ROW_SELECTOR);
                if (first) {
                  e.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            {heading} <span className="q">· {title}</span>
          </h1>
          <StateChip steps={steps} onOpen={(el) => openPop('states', el)} />
        </div>

        {checking ? null : (
          <div className="dr-says" role={says.tone === 'alert' ? 'alert' : undefined}>
            <AnswerBar tone={says.tone} icon={says.icon} title={answerWhyText ? <>{says.text}<WhyNote why={answerWhyText} /></> : says.text} sub={says.sub} actions={answerAction} />
          </div>
        )}

        {!checking && path ? <NextPath steps={path} /> : null}

        <TwinHeader twin={diff.twin} checking={checking} />

        {phase === 'in_browser' ? (
          <p className="dr-poll">
            <span role="status">Waiting for your approval on PayPal</span>
            {/* the seconds tick outside the live region, so they are not read out every second */}
            {lastRead ? <span role="timer" aria-live="off">{` · checked ${Math.max(0, now - lastRead)} s ago`}</span> : ''}
          </p>
        ) : null}
        {outcome && phase !== 'done' && phase !== 'stopped' ? (
          <div className="dr-status" role="status">
            <span className="ui-chip ok">Done</span>
            <span className="t" title={outcome}>{outcome}</span>
          </div>
        ) : null}

        {evidence ? <DiffTable heads={evidence.heads} rows={evidence.rows} set="ev" onOpen={openRow} open={openKey} /> : null}

        {decided ? (
          <Btn kind="plain" sm className="dr-fold" onClick={() => { setPop(null); setDetails(true); }}>
            Your checks before you decided · {checksLine(checks)} ›
          </Btn>
        ) : (
          <section className="dr-checks" aria-label="Safety checks">
            <h2 className="dr-sec">{checking ? 'Checking this against your rules…' : 'Checked by your wallet'}</h2>
            <WalletChecks checks={checks} revealed={checking ? revealed : undefined} />
          </section>
        )}

        {!decided && d.kind !== 'rescue' ? <MarketLine deal={d} onInfo={(el) => openPop('mkt', el)} /> : null}

        {summary.unavailable_reason && !terminal && !(g.ownerAccept.visible && phase === 'ready') ? (
          <div className="dr-mkt">
            <span className="k">Note</span>
            <span className="t" title={reasonWords(summary.unavailable_reason)}>{reasonWords(summary.unavailable_reason)}</span>
            <Btn kind="plain" sm aria-label="The note in full" onClick={(e) => openPop('why', e.currentTarget)}>ⓘ</Btn>
          </div>
        ) : null}

        {handoff?.draft?.type === 'lever' && d.kind === 'rescue' && g.rescue.visible ? (
          <div className="dr-mkt">
            <span className="k">Your pick</span>
            <span className="t">You picked <b>{LEVER_NAME[handoff.draft.lever]}</b> in The Table. Approving it is still your decision, here.</span>
          </div>
        ) : null}

        {d.kind === 'rescue' && summary.rescue ? <InvoiceCard view={summary.rescue} total={total} sent={!!d.paypal.order} /> : null}

        {g.bandSet.visible && !locked ? <BandAdjust deal={d} band={display?.band ?? null} gate={g.bandSet} onDone={refetch} draft={handoff?.draft?.type === 'band' && handoff.deal_id === d.id ? handoff.draft : null} /> : null}
      </main>

      <footer className="dr-foot">
        <Due label={!terminal && phase !== 'done' && deadline ? clockLabelFor(d, phase) : null} deadline={!terminal && phase !== 'done' ? deadline : null}
          silence={!terminal && phase !== 'done' ? silence ?? 'nothing here moves money' : null} />

        {phase === 'hold' && g.releaseHold.visible && !showLock ? (
          <label className="dr-typer" htmlFor="typeName">
            <span>To unpause, type <b className="mono">{expectedName}</b></span>
            <Field
              id="typeName"
              className={namesMatch(typed, expectedName) ? 'ok' : undefined}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  toast('Typing the name doesn’t unpause anything. Press the Unpause button.');
                }
              }}
              autoComplete="off"
              spellCheck={false}
              placeholder={expectedName ?? ''}
              aria-describedby="typeNote"
            />
            <span id="typeNote" className={`st ${namesMatch(typed, expectedName) ? 'ok' : ''}`}>{namesMatch(typed, expectedName) ? <><MarkIcon mark="✓" /> Matches</> : 'exactly as shown'}</span>
          </label>
        ) : null}

        {failure ? <WalletNotice error={failure.error} what={failure.what} /> : null}
        {!s.tokenReady && s.tokenError ? <WalletNotice error={s.tokenError} what="This window can’t approve right now" /> : null}
        {s.unlockError ? <WalletNotice error={s.unlockError} what={s.unlockError.isAvailabilityState ? 'Still locked' : 'Still locked · Windows Hello was cancelled'} /> : null}

        <Actions
          phase={phase}
          gates={g}
          locked={showLock}
          busy={busy}
          pending={s.pending}
          total={total}
          who={who}
          seller={d.side === 'seller'}
          unlocking={s.unlocking}
          canUnlock={s.tokenReady && !(s.settings && !s.settings.native_reauth_available)}
          onUnlock={() => void s.unlock()}
          onDecide={(cmd, what) => void decide(cmd, what)}
          onOpen={() => void openPaypal()}
          onWithdraw={() => setConfirmWithdraw(true)}
          onClose={() => void closeWindow()}
          guardEnter={guardEnter}
          guardEnterHold={guardEnterHold}
        />

        <Hint
          unlocking={s.unlocking}
          locked={showLock}
          helloUnsupported={!!s.settings && !s.settings.native_reauth_available}
          blocked={checking ? null : blockedReason(g, showLock)}
          note={note}
          terminalText={!hasButtons(g, phase, showLock) ? terminalNote(d.state, phase) : null}
          onLock={(el) => openPop('lock', el)}
          onWhat={(el) => openPop('what', el)}
        />
        {closeNote ? <p className="dr-hint" role="status"><span className="t">{closeNote}</span></p> : null}
      </footer>

      {pop && popped ? (
        <Popover anchor={pop.anchor} onClose={() => setPop(null)} title={popped.title} className="dr-pop">
          {popped.body}
        </Popover>
      ) : null}

      {details ? (
        <DetailsSheet
          title={`${label} · ${title}`}
          onClose={() => setDetails(false)}
          heads={diff.heads}
          rows={diff.rows}
          evidence={evidence}
          status={status ? { title: status.title, body: status.body } : null}
          mismatch={mismatchDetail}
          whatItDoes={note?.full ?? null}
          steps={steps}
          countdown={approveCountdown}
          summary={summary}
          transcript={transcript}
          transcriptError={transcriptQ.error}
        />
      ) : null}

      {confirmWithdraw ? (
        <Sheet
          title={`Withdraw ${label}?`}
          size="narrow"
          className="dr-sheet"
          onClose={() => setConfirmWithdraw(false)}
          footer={
            <>
              <Btn className="left" onClick={() => setConfirmWithdraw(false)}>Keep the deal</Btn>
              <Btn kind="danger" onClick={() => void withdraw()} disabled={busy}>Withdraw now</Btn>
            </>
          }
        >
          <p className="pop-p">{d.state === 'APPROVED' ? `You walk away from this deal. The approved order is never paid, and no money moves.` : `You walk away from this deal with ${who}. No money moves.`}</p>
          <p className="ui-hint">Withdrawing can only stop money, so it doesn’t need Windows Hello.</p>
        </Sheet>
      ) : null}
    </div>
  );
}

// ---- footer: buttons and the hint line -------------------------------------------------------

function moneyRelevant(g: Gates): boolean {
  return g.ownerAccept.visible || g.countersign.visible || g.openPaypal.visible || g.capture.visible || g.void.visible || g.releaseHold.visible || g.rescue.visible || g.bandSet.visible;
}

function hasButtons(g: Gates, phase: Phase, locked: boolean): boolean {
  if (locked) return true;
  return moneyRelevant(g) && (g.ownerAccept.visible || g.countersign.visible || g.openPaypal.visible || g.capture.visible || g.void.visible || g.releaseHold.visible || g.rescue.visible)
    || g.withdraw.visible || phase === 'in_browser';
}

function blockedReason(g: Gates, locked: boolean): string | null {
  if (locked) return null;
  const order: Gate[] = [g.ownerAccept, g.countersign, g.openPaypal, g.capture, g.rescue, g.releaseHold, g.void];
  return order.find((x) => x.visible && !x.enabled)?.reason ?? null;
}

/** The money actions that are hold-to-confirm (never Open PayPal, Withdraw, Cancel or Close). */
const HOLD_KEYS: ReadonlySet<string> = new Set(['oa', 'cs', 'cap', 'res', 'rel']);

type Act = { key: string; gate: Gate; label: string; kind: 'gold' | 'default' | 'danger' | 'plain'; money: boolean; run: () => void };

function Actions(p: {
  phase: Phase;
  gates: Gates;
  locked: boolean;
  busy: boolean;
  pending: string | null;
  total: string;
  who: string;
  seller: boolean;
  unlocking: boolean;
  canUnlock: boolean;
  onUnlock: () => void;
  onDecide: (cmd: DecisionCmd, what: string) => void;
  onOpen: () => void;
  onWithdraw: () => void;
  onClose: () => void;
  guardEnter: (e: KeyboardEvent<HTMLElement>) => void;
  guardEnterHold: (e: KeyboardEvent<HTMLElement>) => void;
}) {
  const { gates: g, phase } = p;
  // A hold button remembers that it fired, so it is remounted once the call it started has finished
  // (a refused or failed decision must be holdable again).
  const [gen, setGen] = useState(0);
  const lastPending = useRef(p.pending);
  useEffect(() => {
    if (lastPending.current !== null && p.pending === null) setGen((n) => n + 1);
    lastPending.current = p.pending;
  }, [p.pending]);
  const checking = phase === 'checking';
  const word = (t: string) => `Hold to ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
  const wait = (cmd: string, label: string) => (p.pending === cmd ? 'Working…' : checking ? 'Checking…' : label);
  const safe: Act[] = [];
  const quiet: Act[] = [];
  const money: Act[] = [];
  const always: Gate = { visible: true, enabled: true, reason: null };
  if (g.withdraw.visible) safe.push({ key: 'wd', gate: g.withdraw, label: 'Withdraw', kind: 'danger', money: false, run: p.onWithdraw });
  if (!p.locked) {
    // Void moves toward the safe default, but Rust still treats it as a privileged decision.
    if (g.void.visible) safe.push({ key: 'void', gate: g.void, label: wait('deal_void', 'Cancel and release hold'), kind: 'danger', money: false, run: () => p.onDecide('deal_void', 'Hold not released') });
    if (g.ownerAccept.visible) money.push({ key: 'oa', gate: g.ownerAccept, label: wait('deal_owner_accept', word(`Approve ${p.total}`)), kind: 'gold', money: true, run: () => p.onDecide('deal_owner_accept', 'Not approved') });
    if (g.countersign.visible) money.push({ key: 'cs', gate: g.countersign, label: wait('deal_countersign', word(`Approve ${p.total}`)), kind: 'gold', money: true, run: () => p.onDecide('deal_countersign', 'Not approved') });
    if (g.openPaypal.visible)
      money.push({ key: 'pp', gate: g.openPaypal, label: wait('open_paypal_in_browser', phase === 'in_browser' ? 'Open PayPal again ↗' : 'Open PayPal in your browser ↗'), kind: phase === 'in_browser' ? 'default' : 'gold', money: true, run: p.onOpen });
    if (g.capture.visible) money.push({ key: 'cap', gate: g.capture, label: wait('deal_capture', p.seller ? word(`Collect ${p.total}`) : word(`Pay ${p.who} ${p.total}`)), kind: 'gold', money: true, run: () => p.onDecide('deal_capture', 'Not paid') });
    if (g.rescue.visible) money.push({ key: 'res', gate: g.rescue, label: wait('rescue_approve', word(`Approve the discount · ${p.total}`)), kind: 'gold', money: true, run: () => p.onDecide('rescue_approve', 'Fix not approved') });
    if (g.releaseHold.visible) money.push({ key: 'rel', gate: g.releaseHold, label: wait('shield_release', word('Unpause')), kind: 'gold', money: true, run: () => p.onDecide('shield_release', 'Still paused') });
  }
  if (phase === 'in_browser' || phase === 'done' || phase === 'stopped' || phase === 'mismatch' || phase === 'block')
    quiet.push({ key: 'close', gate: always, label: 'Close this window', kind: 'plain', money: false, run: p.onClose });

  const btn = (a: Act) => {
    const disabled = !a.gate.enabled || (a.key !== 'close' && a.key !== 'wd' && checking) || (a.key !== 'close' && p.busy);
    // What releases or pays money is held, not clicked. Same handler, same enabled state.
    // Opening PayPal is a hand-off (the approval itself happens on PayPal's page), so it stays a click.
    if (a.money && HOLD_KEYS.has(a.key)) {
      return (
        <span key={`${a.key}-${gen}`} className="dr-hold" data-money="" onKeyDownCapture={p.guardEnterHold}>
          <HoldButton kind="gold" disabled={disabled} onConfirm={a.run} title={a.gate.reason ?? undefined} hint="Hold the button down for a moment">
            {a.label}
          </HoldButton>
        </span>
      );
    }
    return (
      <Btn
        key={a.key}
        kind={a.kind}
        disabled={disabled}
        onClick={a.run}
        onKeyDown={a.money ? p.guardEnter : undefined}
        title={a.gate.reason ?? undefined}
        data-money={a.money ? '' : undefined}
      >
        {a.label}
      </Btn>
    );
  };

  if (!safe.length && !quiet.length && !money.length && !p.locked) return null;
  return (
    <div className="dr-btns">
      {safe.map(btn)}
      <span className="sp" />
      {quiet.map(btn)}
      {p.locked ? (
        p.unlocking ? (
          <Btn kind="gold" locked disabled>Windows Hello…</Btn>
        ) : (
          <Btn kind="gold" locked onClick={p.onUnlock} disabled={!p.canUnlock} onKeyDown={p.guardEnter}>
            Unlock with Windows Hello
          </Btn>
        )
      ) : (
        money.map(btn)
      )}
    </div>
  );
}

function Hint(p: {
  unlocking: boolean;
  locked: boolean;
  helloUnsupported: boolean;
  blocked: string | null;
  note: { short: string; full: ReactNode } | null;
  terminalText: string | null;
  onLock: (el: HTMLElement) => void;
  onWhat: (el: HTMLElement) => void;
}) {
  if (p.unlocking) {
    return (
      <p className="dr-hint" role="status">
        <HelloGlyph />
        <span className="t"><b>Windows Hello</b> is checking it’s you…</span>
      </p>
    );
  }
  if (p.locked) {
    return (
      <p className="dr-hint">
        <span className="ui-chip gold"><LockGlyph /> Locked</span>
        <span className="t">
          {p.helloUnsupported ? 'Windows Hello isn’t set up on this computer, so this window can’t unlock. Nothing was unlocked.' : 'Money stays where it is. You can still read everything.'}
        </span>
        <Btn kind="plain" sm aria-label="Why it is locked" onClick={(e) => p.onLock(e.currentTarget)}>ⓘ</Btn>
      </p>
    );
  }
  if (p.blocked) {
    return (
      <p className="dr-hint">
        <MarkIcon mark="i" />
        <span className="t" title={p.blocked}>{p.blocked}</span>
      </p>
    );
  }
  if (p.note) {
    return (
      <p className="dr-hint">
        <span className="t">{p.note.short}</span>
        <Btn kind="plain" sm aria-label="What this does, in full" onClick={(e) => p.onWhat(e.currentTarget)}>ⓘ</Btn>
      </p>
    );
  }
  if (p.terminalText) {
    return (
      <p className="dr-hint">
        <span className="t">{p.terminalText}</span>
      </p>
    );
  }
  return null;
}

// ---- the rescue invoice ------------------------------------------------------------------------

/** The invoice's fixed wording, as the wallet will send it (Rust table-core invoice_text): the owner
 *  reads exactly what PayPal shows the subscriber. No agent or subscriber text is in it. */
function InvoiceCard({ view, total, sent }: { view: NonNullable<ApprovalSummary['rescue']>; total: string; sent: boolean }) {
  return (
    <section className="dr-inv" aria-label="The invoice">
      <h2 className="dr-sec">{sent ? 'The invoice PayPal sent' : 'The invoice PayPal will send'} <span className="dim">· to {view.recipient}</span></h2>
      <div className="dr-inv-b">
        <div className="ln"><span className="it">{view.text.item}</span><b className="money">{total}</b></div>
        <p className="nt">{view.text.note}</p>
      </div>
    </section>
  );
}

// ---- words -----------------------------------------------------------------------------------

function verb(d: Deal, ownerAccept: boolean): string {
  if (ownerAccept) return 'Accept the offer from';
  if (d.kind === 'rescue') return 'Fix a failed renewal for';
  if (d.state === 'AUTHORIZED' && d.side === 'seller') return 'Collect from';
  if (d.state === 'AUTHORIZED' && d.kind === 'purchase') return 'Pay';
  if (d.side === 'seller') return 'Sell to';
  return 'Pay';
}

function clockLabelFor(d: Deal, phase: Phase): string {
  if (phase === 'hold') return 'Request ends in';
  if (d.kind === 'rescue') return d.state === 'AGREED' ? 'PayPal retries in' : 'Invoice open for';
  switch (d.state) {
    case 'AWAITING_APPROVAL': return 'Time to approve on PayPal';
    case 'AUTHORIZED': return 'Hold releases in';
    case 'AGREED': return 'Time to approve';
    case 'PAIRING': case 'LISTED': case 'NEGOTIATING': return 'Offer ends in';
    default: return 'Deadline in';
  }
}

type Status = { chip: string; title: string; body: string };

function statusOf(phase: Phase, d: Deal, s: ApprovalSummary, total: string, cp: string): Status | null {
  switch (phase) {
    case 'in_browser':
      return { chip: 'gold', title: 'PayPal is open in your browser', body: `Approve ${total} on PayPal’s own ${d.mode === 'sandbox' ? 'sandbox ' : ''}page there. PayPal never opens inside this app. The wallet checks with PayPal itself that you approved, and never trusts the page you are sent back to. You can close this window; the mini window keeps watching for you.` };
    case 'waiting':
      return { chip: 'gold', title: waitingTitle(d, cp), body: waitingText(d, cp) };
    case 'done':
      return { chip: 'ok', title: `${stateWord(d.state)} · ${total}`, body: doneText(d, s, total) };
    case 'stopped':
      return { chip: d.state === 'REFUSED' || d.state === 'FAILED' || d.state === 'DISPUTED' ? 'red' : '', title: stoppedText(d), body: stoppedText(d) };
    case 'block':
      return { chip: 'red', title: 'Blocked by a scam check', body: 'A block can’t be overridden, here or anywhere. No money moved.' };
    default:
      return null;
  }
}

function noteFor(phase: Phase, g: Gates, d: Deal, total: string, cp: string): { short: string; full: ReactNode } | null {
  if (phase === 'mismatch') return { short: 'There is no “pay anyway” when amounts don’t match. On purpose.', full: <p className="pop-p">There is on purpose no “pay anyway” when the amounts don’t match. The deal stopped here and no money moved.</p> };
  if (phase === 'checking') return null;
  if (g.ownerAccept.visible) {
    return {
      short: 'Approving agrees the price only. No money moves until you approve on PayPal.',
      full: (
        <div className="owner-accept-note">
          <p className="pop-p"><b>{cp}’s latest offer is {total}.</b> Your rules leave this price to you, not to the agent.</p>
          <ol>
            <li>Approving signs exactly this offer with your owner key.</li>
            <li>It moves no money: nothing is charged, held or sent to PayPal.</li>
            <li>Paying comes next, on PayPal’s own page in your browser, once {cp}’s wallet sends the payment request.</li>
          </ol>
        </div>
      ),
    };
  }
  if (g.openPaypal.visible && phase !== 'in_browser') return { short: 'Opens PayPal’s own page in your browser. You approve there.', full: <p className="pop-p">Only possible when no check above failed. PayPal’s page opens in your own browser, never inside this app. The wallet then checks with PayPal itself that you approved, and never trusts the page you are sent back to.</p> };
  if (g.releaseHold.visible) return { short: 'Unpausing lets the request go on. It doesn’t pay anything.', full: <p className="pop-p">Unpausing turns “Paused for you” into “Check with you”. It doesn’t pay: you still approve the payment itself afterwards.</p> };
  if (g.capture.visible) return { short: d.side === 'seller' ? `Collecting takes the ${total} on hold. Releasing cancels it.` : `Paying sends the ${total} on hold to ${cp}. Releasing cancels it, nothing is paid.`, full: <p className="pop-p">{d.side === 'seller' ? `Collecting takes the ${total} PayPal is holding for you.` : `Paying sends the ${total} PayPal is holding to ${cp}.`} Releasing cancels the hold and nothing is paid. If nobody decides, the hold releases by itself after 3 days.</p> };
  if (g.countersign.visible) return { short: d.state === 'APPROVED' ? 'Approving puts the money on hold. Paying is a separate step.' : 'Approving creates the PayPal order. No money moves yet.', full: <p className="pop-p">{d.state === 'APPROVED' ? 'Approving puts the money the buyer approved on hold at PayPal. Collecting it comes back to this window as its own decision.' : 'Approving creates the PayPal order from what you agreed. No money moves until the buyer approves on PayPal’s page.'}</p> };
  if (g.rescue.visible) return { short: d.mode === 'replay' ? 'Sends one real invoice. A replayed failure is never counted.' : 'Sends one PayPal invoice to this one subscriber. Nothing is charged.', full: <><p className="pop-p">{RESCUE_APPROVE_DOES}</p>{d.mode === 'replay' ? <p className="pop-p">{RESCUE_REPLAY_NOT_COUNTED}</p> : null}</> };
  return null;
}

function outcomeText(cmd: DecisionCmd, deal: Deal, cp: string): string {
  const st = stateWord(deal.state);
  const pp = deal.paypal;
  switch (cmd) {
    case 'deal_owner_accept':
      return deal.state === 'AGREED'
        ? `Approved. You and ${cp} agreed ${formatMoney(dealTotal(deal))}. No money moved. Paying opens here once their payment request is checked.`
        : `Your approval is recorded (${st.toLowerCase()}). No money moved; the deal is agreed once ${cp}’s wallet answers.`;
    case 'deal_countersign':
      return deal.state === 'AUTHORIZED'
        ? 'Approved. The money is on hold at PayPal, not paid yet.'
        : `Approved (${st.toLowerCase()})${pp.order ? ' · the PayPal order is made' : ''}. No money moved yet.`;
    case 'deal_capture':
      return `Payment sent · ${st.toLowerCase()}${pp.capture ? ' · confirmed by PayPal' : ''}.`;
    case 'deal_void':
      return deal.state === 'VOIDED' ? 'Hold released. Nothing was paid.' : `Release requested (${st.toLowerCase()}).`;
    case 'shield_release':
      return `Unpaused (${deal.shield === 'ASK' ? 'now checks with you' : st.toLowerCase()}). Nothing was paid.`;
    case 'rescue_approve':
      return deal.state === 'AWAITING_APPROVAL'
        ? 'Approved. PayPal sent the invoice to the subscriber. Nothing is paid until they pay it.'
        : `Approved. PayPal is making the invoice (${st.toLowerCase()}); nothing more is sent until the wallet knows it was made.`;
  }
}

function waitingTitle(d: Deal, cp: string): string {
  if (d.kind === 'rescue') return d.state === 'SETTLING' ? 'PayPal is making the invoice' : 'The invoice is with the subscriber';
  if (d.state === 'AGREED') return `Agreed · waiting for ${cp}’s payment request`;
  if (d.state === 'SETTLING') return `${cp}’s wallet is making the PayPal order`;
  if (d.side === 'seller' && d.state === 'AWAITING_APPROVAL') return 'Waiting for the buyer to approve on PayPal';
  if (d.side === 'seller' && d.state === 'APPROVED') return 'The buyer approved on PayPal';
  return 'You approved on PayPal';
}

function doneText(d: Deal, s: ApprovalSummary, total: string): string {
  const ev = s.evidence;
  const evidence = receiptWord(ev.receipt).text;
  const recon = ev.reconciliation === 'not_applicable' ? '' : reconWord(ev.reconciliation).text.toLowerCase();
  return `${total}${d.paypal.capture ? ' paid' : ''} · ${evidence}${recon ? ` · ${recon}` : ''}. Reference numbers are under Details.`;
}

function terminalNote(state: Deal['state'], phase: Phase): string {
  if (phase === 'block') return 'A blocked payment can’t be released. Nothing is left to decide here.';
  if (phase === 'done') return 'Nothing is left to decide here. You can close this window.';
  if (phase === 'waiting') return 'Nothing to decide right now. This window updates by itself.';
  if (isTerminal(state)) return 'This deal is closed. You can close this window.';
  return 'No decision is available for this deal in its current state.';
}
