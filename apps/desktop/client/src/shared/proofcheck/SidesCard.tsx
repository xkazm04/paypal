// "Provable by both sides": the other side's file next to this one, and whether the two tell the same
// story (lib/proof/sides). The other file is checked here too, with the same checks, and then the two are
// compared on what they say about the deal: the same signed messages, the same price, the same payment.
import { useEffect, useRef, useState } from 'react';
import { PROOF_CHECKER as W } from '../../lib/words';
import { compareSides, type Agreement, type Side, sideOf } from '../../lib/proof/sides';
import { checkProofText, PROOF_FILE_LIMIT, prepareProof, TOO_LARGE } from '../../lib/proof/verify';
import { Btn, Chip } from '../ui';
import type { ProofSource } from './ProofChecker';

/** The other file, checked: what it says about the deal, or why it could not be read. */
type Other = { name: string; side: Side } | { name: string; refused: string } | null;

async function readOther(source: ProofSource, own: string | null): Promise<Other> {
  const outcome = await checkProofText(source.text, own);
  if ('refused' in outcome) return { name: source.name, refused: outcome.refused };
  const prepared = await prepareProof(source.text);
  if ('refused' in prepared) return { name: source.name, refused: prepared.refused };
  return { name: source.name, side: await sideOf(prepared, outcome.report.verified) };
}

export function SidesCard({ mine, candidates, own, headingLevel }: { mine: Side | null; candidates: readonly ProofSource[]; own: string | null; headingLevel: 2 | 3 }) {
  const H = `h${headingLevel}` as 'h2' | 'h3';
  const input = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<ProofSource | null>(null);
  const [other, setOther] = useState<Other>(null);
  const [reading, setReading] = useState(false);
  useEffect(() => {
    if (!source) {
      setOther(null);
      return undefined;
    }
    let live = true;
    setReading(true);
    void readOther(source, own).then((o) => {
      if (!live) return;
      setOther(o);
      setReading(false);
    });
    return () => { live = false; };
  }, [source, own]);

  const pick = async (file: File) => {
    if (file.size > PROOF_FILE_LIMIT) {
      setOther({ name: file.name, refused: TOO_LARGE });
      return;
    }
    setSource({ name: file.name, text: await file.text() });
  };
  const lines: Agreement[] = mine && other && 'side' in other ? compareSides(mine, other.side) : [];
  const differ = lines.some((l) => l.agree === false);

  return (
    <section className="pk-sides" aria-label={W.sides.head}>
      <H className="pk-h">{W.sides.head}</H>
      <p className="ui-hint">{W.sides.intro}</p>
      <div className="pk-acts">
        {candidates.filter((c) => c.name !== source?.name).map((c) => (
          <Btn key={c.name} sm onClick={() => setSource(c)}>{W.sides.use(c.label ?? c.name)}</Btn>
        ))}
        <Btn sm onClick={() => input.current?.click()}>{W.sides.open}</Btn>
        {source ? <Btn sm kind="plain" onClick={() => setSource(null)}>{W.sides.remove}</Btn> : null}
        <input ref={input} type="file" accept=".tableproof,.json,application/json" className="sr-only" tabIndex={-1} aria-hidden="true"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = ''; }} />
      </div>
      {reading ? <p className="ui-hint" role="status">{W.sides.comparing}</p> : null}
      {other && 'refused' in other ? <p className="pk-refused" role="alert">{other.refused}</p> : null}
      {lines.length > 0 ? (
        <div className="pk-agree" role="group" aria-label={W.sides.head}>
          <p className="pk-agreed" role="status">
            <Chip tone={differ ? 'red' : 'ok'}>{differ ? W.sides.differ : W.sides.agree}</Chip>
            <span className="dim">{other && 'side' in other ? other.name : ''}</span>
          </p>
          <ul className="pk-alist">
            {lines.map((l) => (
              <li key={l.id} className={l.agree === null ? 'dashed' : l.agree ? 'ok' : 'bad'}>
                <span className="pk-mark" aria-hidden="true">{l.agree === null ? '–' : l.agree ? '✓' : '✗'}</span>
                <span className="sr-only">{l.agree === null ? W.sr.unchecked : l.agree ? W.sr.passed : W.sr.failed}. </span>
                <span><b>{W.sides.lines[l.id]}</b><span className="ui-hint mono"> {l.detail}</span></span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
