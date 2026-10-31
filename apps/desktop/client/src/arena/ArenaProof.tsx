// Break The Table's finale, "Check the proof yourself": the attack deal's recorded signed file
// (lib/proof/arenaBundles.ts) opened inline in e2's proof checker (shared/proofcheck/ProofChecker.tsx),
// checked on arrival by the same checks the wallet runs. The person can break it on purpose and watch the
// right check turn red. The file never leaves the page. Only Maya's agent's attacks leave a deal file
// of their own; a round of seller attacks says so instead of showing a file that is not theirs.
import { useEffect, useId, useMemo, useState } from 'react';
import { AUTHORITY_MANIFEST } from '@bindings/authority';
import { ARENA_BUNDLE_IDS, arenaBundleName, arenaBundleStem, loadArenaBundle } from '../lib/proof/arenaBundles';
import { ARENA_PROOF } from '../lib/words/arena';
import { ProofChecker } from '../shared/proofcheck/ProofChecker';
import { ATTACK_WORDS } from './model';
import type { RecordedAttack } from './record';

/** The played attacks that have a recorded file, the latest played first, each once. */
export function provable(played: readonly RecordedAttack[]): string[] {
  const out: string[] = [];
  for (let i = played.length - 1; i >= 0; i--) {
    const id = played[i]?.id;
    if (id && ARENA_BUNDLE_IDS.includes(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

export function ArenaProof({ played, pageLink }: { played: readonly RecordedAttack[]; /** Link to proof.html (only where that page is served). */ pageLink: boolean }) {
  const ids = useMemo(() => provable(played), [played]);
  const [picked, setPicked] = useState<string | null>(null);
  const id = picked !== null && ids.includes(picked) ? picked : ids[0] ?? null;
  const [file, setFile] = useState<{ id: string; text: string } | null>(null);
  const selectId = useId();
  useEffect(() => {
    if (id === null) return;
    let live = true;
    void loadArenaBundle(id).then((text) => { if (live && text !== null) setFile({ id, text }); }, () => undefined);
    return () => { live = false; };
  }, [id]);
  const title = (x: string) => ATTACK_WORDS[x]?.title ?? x;
  return (
    <section className="ar-proofcheck" aria-label={ARENA_PROOF.heading}>
      <h4>{ARENA_PROOF.heading}</h4>
      <p className="ar-hint">{ARENA_PROOF.sub}</p>
      {id === null ? <p className="ar-hint">{ARENA_PROOF.none}</p> : (
        <>
          <div className="ar-proofcheck-pick">
            {ids.length > 1 ? (
              <>
                <label htmlFor={selectId}>{ARENA_PROOF.pick}</label>
                <select id={selectId} className="ui-field" value={id} onChange={(e) => setPicked(e.target.value)}>
                  {ids.map((x) => <option key={x} value={x}>{ARENA_PROOF.label(title(x))}</option>)}
                </select>
              </>
            ) : <span>{ARENA_PROOF.label(title(id))}</span>}
            {pageLink ? <a className="ui-btn sm plain" href={`proof.html?file=${encodeURIComponent(arenaBundleStem(id))}`} target="_blank" rel="noopener" title={ARENA_PROOF.pageTitle}>{ARENA_PROOF.page}</a> : null}
          </div>
          {file && file.id === id ? (
            <ProofChecker key={id} source={{ name: arenaBundleName(id), text: file.text, label: ARENA_PROOF.label(title(id)) }} own={AUTHORITY_MANIFEST} heading={false} lede={false} level={3} autoRun />
          ) : <p className="ar-hint" role="status">{ARENA_PROOF.loading}</p>}
        </>
      )}
    </section>
  );
}
