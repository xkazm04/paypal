// BROWSER PREVIEW ONLY. Break The Table's answer: what the wallet did with one attack, from the record
// only (record.ts). First Maya's words (the verdict, why it held, the rule), then the wallet's own
// record one level down (the rows it wrote, what was sent beside what PayPal saw, what the agent could
// still see). And the closing view: every attack held, the command that checks it, the attacks as a file.
import { useState } from 'react';
import { ARENA_ANSWER, ARENA_CHECK, ARENA_FINALE, ARENA_NOTE, ARENA_VERDICT, ATTACK_WORDS } from '../lib/words/arena';
import { Quarantine } from '../shared/honesty';
import { Btn } from '../shared/ui';
import { NoteChip } from '../windows/main/console/areas/shared/NoteChip';
import { Gauntlet } from './Gauntlet';
import { auditLine, dollars, minorOf, noteAsks, ruleName, stateWords, verdictOf, type Verdict } from './model';
import { PROOF_FILE_NAME, proofFile } from './proof';
import { attackById, isRefusal, RECORD, type RecordedAttack } from './record';

const NEWLINE = String.fromCharCode(10);

export const VERDICT_WORDS: Record<Verdict, string> = {
  refused: ARENA_VERDICT.refused, turnedAway: ARENA_VERDICT.turnedAway, kept: ARENA_VERDICT.kept, counted: ARENA_VERDICT.counted,
};

export function Answer({ attack: a, sentNote, noteDealId }: { attack: RecordedAttack; sentNote: string | null; noteDealId: string | null }) {
  const w = ATTACK_WORDS[a.id];
  const v = verdictOf(a);
  const ans = a.answer;
  const which = a.deal.which === 'purchase' ? ARENA_ANSWER.purchase : ARENA_ANSWER.haggle;
  const asks = sentNote ? noteAsks(sentNote, { mostMinor: minorOf(RECORD.rules.most), perDealMinor: minorOf(RECORD.rules.per_deal) }) : [];
  return (
    <article className={`ar-answer v-${v}`}>
      <div className="ar-answer-h">
        <span className={`ar-stamp v-${v}`}>{VERDICT_WORDS[v]}</span>
        <h3>{w?.title ?? a.id}</h3>
      </div>
      {sentNote !== null ? (
        <div className="ar-yournote">
          <p>{ARENA_NOTE.sent}</p>
          {noteDealId ? <NoteChip dealId={noteDealId} who={ARENA_NOTE.chipWho} /> : null}
        </div>
      ) : null}
      <dl className="ar-why">
        <div><dt>{ARENA_ANSWER.why}</dt><dd>{w?.held}{isRefusal(ans) ? <span className="ar-rule">{ruleName(ans.code, ans.clause)}</span> : null}</dd></div>
        {isRefusal(ans) ? <div><dt>{ARENA_ANSWER.heard}</dt><dd className="ar-heard">“{ans.text}”</dd></div> : null}
        {!isRefusal(ans) && ans.why ? <div><dt>{ARENA_ANSWER.heard}</dt><dd className="ar-heard">{ARENA_ANSWER.why_kept(ans.why)}</dd></div> : null}
      </dl>
      {sentNote !== null ? <NoteAsks asks={asks} /> : null}
      <section className="ar-proof" aria-label={ARENA_ANSWER.record}>
        <h4>{ARENA_ANSWER.record}<span className="ar-sub"> · {ARENA_ANSWER.recordSub}</span></h4>
        <p className="ar-rows-h">{ARENA_ANSWER.rows(a.audit.length)}</p>
        {a.audit.length ? <ul className="ar-audit mono">{a.audit.map((r) => <li key={r.seq}>{auditLine(r)}</li>)}</ul> : null}
        <div className="ar-split">
          <div className="ar-sent">
            <h5>{a.suit === 'agent' ? ARENA_ANSWER.sent : sentNote !== null ? ARENA_NOTE.recorded : ARENA_ANSWER.sentEnvelope}</h5>
            <Sent attack={a} />
          </div>
          <div className={`ar-paypal${a.paypal_requests === 0 ? ' none' : ''}`}>
            <h5>{ARENA_ANSWER.paypal}</h5>
            <p className="ar-paypal-n">{a.paypal_requests === 0 ? ARENA_ANSWER.paypalNone : ARENA_ANSWER.paypalSome(a.paypal_requests)}</p>
            <p className="ar-hint">{ARENA_ANSWER.paypalRows(a.paypal_calls)} · {ARENA_ANSWER.moneyOps(a.money_operations)}</p>
          </div>
        </div>
        {a.agent_saw ? (
          <div className="ar-saw">
            <h5>{ARENA_ANSWER.agentSaw}</h5>
            <p className="ar-hint">{ARENA_ANSWER.agentSawSub}</p>
            <ul className="mono">
              {a.agent_saw.history.map((s) => <li key={`${s.by}-${s.seq}-${s.act}`}>{s.by} · {s.act} · {dollars(s.price)}</li>)}
            </ul>
            <p className="ar-saw-ok">{ARENA_ANSWER.noNote}</p>
          </div>
        ) : null}
        <p className="ar-hint">{ARENA_ANSWER.dealState(which, stateWords(a.deal.before), stateWords(a.deal.after))}</p>
      </section>
    </article>
  );
}

/** What was sent: the agent's tool call (its name, then its arguments), or the seller's envelope. A
 *  seller's note is their words: drawn only through Quarantine, never as plain page text. */
function Sent({ attack: a }: { attack: RecordedAttack }) {
  if (a.suit === 'agent') {
    const { name, arguments: args } = a.sent as { name?: unknown; arguments?: unknown };
    return <pre className="mono"><b>{String(name)}</b>{NEWLINE}{JSON.stringify(args, null, 1)}</pre>;
  }
  const { text, ...rest } = a.sent as { text?: unknown };
  return (
    <>
      <pre className="mono">{JSON.stringify(rest, null, 1)}</pre>
      {typeof text === 'string' ? <Quarantine text={text} label={ARENA_ANSWER.theirWords} /> : null}
    </>
  );
}

function NoteAsks({ asks }: { asks: string[] }) {
  return (
    <div className="ar-asks">
      <h5>{ARENA_NOTE.obeyed}</h5>
      {asks.length === 0 ? <p className="ar-hint">{ARENA_NOTE.obeyedNone}</p> : (
        <ul>
          {asks.map((id) => {
            const a = attackById(id);
            if (!a || !isRefusal(a.answer)) return null;
            return <li key={id}><b>{ATTACK_WORDS[id]?.title}</b> <span className="ar-stamp sm v-refused">{ARENA_VERDICT.refused}</span> <span className="ar-rule">{ruleName(a.answer.code, a.answer.clause)}</span></li>;
          })}
        </ul>
      )}
    </div>
  );
}

/** The closing view: what the judge's attacks added up to, the command, and the attacks as a file. */
export function Finale({ played }: { played: readonly RecordedAttack[] }) {
  const [copied, setCopied] = useState(false);
  const file = proofFile(played);
  const s = file.summary;
  const copy = () => {
    void navigator.clipboard?.writeText(RECORD.check).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }, () => undefined);
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(file, null, 2)}\n`], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = PROOF_FILE_NAME;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const allHeld = s.played > 0 && s.held === s.played && s.moved !== null;
  return (
    <article className="ar-answer ar-finale">
      {s.played === 0 ? <p className="ar-drop-h">{ARENA_FINALE.none}</p> : (
        <>
          <div className="ar-answer-h">
            {allHeld ? <span className="ar-stamp v-held">{ARENA_FINALE.stamp}</span> : null}
            <h3>{ARENA_FINALE.title(s.distinct, s.of)}</h3>
          </div>
          <p className="ar-finale-figs num">{ARENA_FINALE.figures(s.moved ?? '—', s.paypal_requests, s.paypal_calls, s.money_operations)}</p>
          {s.distinct < s.of ? <p className="ar-hint">{ARENA_FINALE.untried(s.of - s.distinct)}</p> : null}
        </>
      )}
      <section className="ar-finale-run">
        <p className="ar-finale-lead">{ARENA_FINALE.run}</p>
        <div className="ar-cmd big"><code className="mono">{RECORD.check}</code><Btn sm onClick={copy}>{copied ? ARENA_CHECK.copied : ARENA_CHECK.copy}</Btn></div>
        <p className="ar-hint">{ARENA_FINALE.runSub} {ARENA_CHECK.seed(RECORD.seed)}</p>
      </section>
      <Gauntlet />
      {s.played > 0 ? (
        <section className="ar-finale-file">
          <h4>{ARENA_FINALE.file}</h4>
          <p className="ar-hint">{ARENA_FINALE.fileSub}</p>
          <Btn kind="primary" onClick={download}>{ARENA_FINALE.download}</Btn>
        </section>
      ) : null}
    </article>
  );
}
