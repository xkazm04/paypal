// The sign sheet (Layer 2): the diff, the consequences in plain words, and exactly what this
// window sends. Its gold button is "Unlock with Windows Hello" while idle-locked, then
// "Sign vN with owner key" (mandate_sign, privileged). The sheet focuses its heading, so Enter
// signs nothing.
import { useState } from 'react';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import type { MandateSignArgs } from '@bindings/MandateSignArgs';
import type { OpenMandate } from '@bindings/OpenMandate';
import type { WalletError } from '../../../lib/contract';
import { shortHash } from '../../../lib/format';
import { ruleNameOf, rulesName } from '../../../lib/words';
import { WalletNotice } from '../../../shared/honesty';
import { Btn, Hourglass, Kv, Section, Sheet } from '../../../shared/ui';
import { refusalWords, type RuleProblem } from '../mandateDraft';
import { useSession } from '../session';
import { DirChip } from './Lever';
import { termWord, type Change } from './diff';

/** Canonical JSON (sorted keys, no whitespace): the exact bytes of the request this window sends. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

type Props = {
  base: MandateListEntry | null;
  args: MandateSignArgs;
  changes: Change[];
  /** The wallet's what-if for this draft (mandate_simulate): the one-line summary and what moved. */
  whatIf: { summary: string; hits: string } | null;
  problems: RuleProblem[];
  onClose: () => void;
  onSigned: (m: OpenMandate) => void;
};

export function SignSheet({ base, args, changes, whatIf, problems, onClose, onSigned }: Props) {
  const s = useSession();
  const [error, setError] = useState<WalletError | null>(null);
  const locked = s.settingsLocked || s.lockedByError;
  const v = base ? base.payload.version + 1 : 1;
  const who = base ? `${rulesName(base.agent).toLowerCase()} changes` : `new ${rulesName(args.agent).toLowerCase()}`;
  const bytes = canonical(args);
  const size = new TextEncoder().encode(bytes).length;
  const busy = s.pending !== null || s.unlocking;

  const sign = async () => {
    setError(null);
    const r = await s.call('mandate_sign', args, true);
    if (r.ok) onSigned(r.value);
    else setError(r.error);
  };

  const footer = (
    <>
      <Btn className="left" onClick={onClose}>Keep editing</Btn>
      {locked ? (
        <Btn kind="gold" locked disabled={!s.tokenReady || busy} onClick={() => void s.unlock()}>
          {s.unlocking ? 'Waiting for Windows Hello…' : 'Unlock with Windows Hello'}
        </Btn>
      ) : (
        <Btn kind="gold" disabled={!s.tokenReady || busy || problems.length > 0} onClick={() => void sign()}>
          {s.pending === 'mandate_sign' ? 'Signing…' : 'Sign with your owner key'}
        </Btn>
      )}
    </>
  );

  return (
    <Sheet title={`Sign ${who} · ${changes.length ? `${changes.length} change${changes.length > 1 ? 's' : ''}` : base ? 'sign again' : `${args.clauses.length} rules`}`} size="wide" onClose={onClose} footer={footer} className="ow-sign">
      {changes.length ? (
        <div className="ui-group">
          <table className="ui-table">
            <thead>
              <tr>
                <th>What</th>
                <th>Now</th>
                <th>After signing</th>
                <th>Effect</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((c, i) => (
                <tr key={i}>
                  <td>{termWord(c.term)}</td>
                  <td className="num dim"><s>{c.from}</s></td>
                  <td className="num"><b>{c.to}</b></td>
                  <td><DirChip dir={c.dir} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="ow-p">{base ? 'The same rules, signed again.' : 'No rules yet.'}</p>
      )}

      <Section title="In plain words">
        <ul className="ow-conseq">
          {changes.map((c, i) => (
            <li key={i} className={c.dir}>
              {c.text}.
            </li>
          ))}
          <li className="live">
            {whatIf
              ? `${whatIf.summary}${whatIf.hits ? ` Against the rules now, it would have ${whatIf.hits}.` : ' No deal this week would have gone differently.'}`
              : 'This week’s deals haven’t been tried against this version yet.'}
          </li>
          <li className="live">New rules apply to new requests only. Anything already on hold, invoiced or approved stays as it is.</li>
          {base ? <li className="live">Haggles still open stay tied to the version they started under, so once you sign they need starting again.</li> : null}
        </ul>
        {problems.length ? (
          <ul className="ow-warns" aria-label="Why this can’t be signed yet">
            {problems.map((p, i) => <li key={i}>{ruleNameOf(p.clause)}: {p.why}</li>)}
          </ul>
        ) : null}
        <p className="ui-hint">This week’s deals were tried with the wallet’s own check. Signing checks everything again, and every new request is checked too.</p>
      </Section>

      <Section title="What you sign"> 
        <Kv
          items={[
            ['For', `your ${args.agent} agent`],
            ['In force', `${new Date(args.not_before * 1000).toLocaleString('en-GB')} → ${new Date(args.expires * 1000).toLocaleString('en-GB')} · then its agent stops · no money moves`],
            ['Applies to', 'every new request from that agent'],
            ['Signed with', 'your owner key, after Windows Hello'],
            ['Reference', <span key="r" className="mono">{base ? `${base.payload.id} · version ${v} · agent key ${shortHash(base.payload.agent_key)}` : 'given when you sign · version 1'}</span>],
          ]}
        />
        <details className="ow-bytes">
          <summary>Exactly what this window sends ({size} bytes), for the technically curious</summary>
          <pre tabIndex={0} aria-label="Exactly what is sent">{JSON.stringify(args, null, 2)}</pre>
        </details>
      </Section>

      {error ? <WalletNotice error={error} what="Not signed" message={error.code === 'REFUSED' ? refusalWords(error.message) : undefined} /> : null}
      <p className="ui-silence ow-endline">
        <Hourglass /><span className="if">If you close this: </span><b>nothing is signed</b> · {base ? 'your current rules stay in force' : 'no rules are created'} · no money moves
      </p>
    </Sheet>
  );
}
