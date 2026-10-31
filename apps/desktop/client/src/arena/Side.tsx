// Break The Table's side column, in both hosts (arena.html on the browser mock, and the console's place
// "Try to break it", which also runs in the desktop app): the safety record of the wallet this page reads
// (the console's safety_record read and its sentences, windows/main/safety/model.ts), read again after
// every attack, with the rows this session's attacks wrote; and the command that checks every answer.
// On sample data (the browser mock, a desktop demo) that record is Maya's sample week and the panel says
// so; in the desktop app's live wallet it is the owner's own (sampleRecord, arenaSafetyWords).
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '../lib/hooks';
import { demoNow } from '../lib/preview';
import { ARENA_CHECK, ARENA_SAFETY, arenaSafetyWords } from '../lib/words/arena';
import { Btn } from '../shared/ui';
import { safetyWords } from '../windows/main/safety/model';
import { ATTACK_WORDS, auditLine, verdictOf } from './model';
import { RECORD, type RecordedAttack } from './record';

export type Played = { n: number; attack: RecordedAttack };

/** The record this page reads is sample data: always in a browser, and in the desktop app only in a
 *  demo world (lib/preview.ts demoNow; null state = the live wallet). */
export function sampleRecord(): boolean {
  const d = demoNow();
  return !d.native || d.state !== null;
}

/** `onOpen`: the console's move to the safety record (LayerNav); without it (the page) a link opens it
 *  in the preview's main window. */
export function SafetyPanel({ plays, onOpen, sample = sampleRecord() }: { plays: readonly Played[]; onOpen?: () => void; /** Whose record: Maya's sample week, or the owner's own. */ sample?: boolean }) {
  const t = arenaSafetyWords(sample);
  const q = useQuery('safety_record', null);
  const first = useRef<number | null>(null);
  const { refetch } = q;
  // Read the record again after every attack (the arena wrote its row into the shared world).
  useEffect(() => { if (plays.length) void refetch(); }, [plays.length, refetch]);
  const r = q.data;
  if (r && first.current === null) first.current = r.refusals - plays.filter((p) => 'code' in p.attack.answer).length;
  const words = r ? safetyWords(r) : null;
  const added = r && first.current !== null ? r.refusals - first.current : 0;
  return (
    <section className="ar-record" aria-label={t.heading}>
      <h2>{t.heading}</h2>
      <p className="ar-sub">{t.sub}</p>
      {words ? (
        <div className={`ar-sr tone-${words.tone}`}>
          <p className="ar-sr-v">{words.verdict}</p>
          <p className="ar-sr-l">{words.lines[2] ?? words.lines[0]}</p>
          {added > 0 ? <span key={added} className="ar-sr-add">{ARENA_SAFETY.added(added)}</span> : null}
        </div>
      ) : <p className="ar-hint">{t.reading}</p>}
      <h3 className="ar-h3">{ARENA_SAFETY.session}</h3>
      {plays.length === 0 ? <p className="ar-hint">{ARENA_SAFETY.sessionNone}</p> : (
        <ol className="ar-rows" reversed>
          {[...plays].reverse().map((p) => (
            <li key={p.n} className={`v-${verdictOf(p.attack)}`}>
              <span className="ar-row-t">{ATTACK_WORDS[p.attack.id]?.title ?? p.attack.id}</span>
              {p.attack.audit.map((row) => <span key={row.seq} className="ar-row-a mono">{auditLine(row)}</span>)}
            </li>
          ))}
        </ol>
      )}
      {onOpen ? <Btn sm kind="plain" className="ar-open" onClick={onOpen}>{ARENA_SAFETY.openHere}</Btn>
        : <a className="ar-open" href="index.html#p=safety" target="_blank" rel="noopener">{ARENA_SAFETY.open}</a>}
    </section>
  );
}

export function CheckIt() {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(RECORD.check).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }, () => undefined);
  };
  return (
    <section className="ar-check" aria-label={ARENA_CHECK.heading}>
      <h2>{ARENA_CHECK.heading}</h2>
      <p className="ar-sub">{ARENA_CHECK.sub}</p>
      <div className="ar-cmd"><code className="mono">{RECORD.check}</code><Btn sm onClick={copy}>{copied ? ARENA_CHECK.copied : ARENA_CHECK.copy}</Btn></div>
    </section>
  );
}
