import { useEffect, useState } from 'react';
import { AUTHORITY_MANIFEST } from '@bindings/authority';
import { ATTACK_WORDS } from '../arena/model';
import { arenaBundleId, arenaBundleName, loadArenaBundle } from '../lib/proof/arenaBundles';
import { SAMPLES } from '../lib/proof/sample';
import { TAMPERS, type TamperId } from '../lib/proof/tamper';
import { PROOF_CHECKER } from '../lib/words';
import { ARENA_PROOF } from '../lib/words/arena';
import { ProofChecker, type ProofSource } from '../shared/proofcheck/ProofChecker';

/** Links made for showing it: `?check=1` checks on arrival, `?break=price` then breaks it that way,
 *  `?edit=1` opens on the file's text, `?demo=1` plays it through by itself (for a recording), and
 *  `?file=arena-<attack id>` opens one of Break The Table's recorded deal files (and checks it on
 *  arrival). A `file` that names none of those files is ignored: the page opens on its practice deal. */
export function arrival(search: string): { autoRun: boolean; autoTamper: TamperId | null; startEditing: boolean; demo: boolean; file: string | null } {
  const q = new URLSearchParams(search);
  const way = q.get('break');
  const autoTamper = TAMPERS.find((t) => t.id === way)?.id ?? null;
  const file = arenaBundleId(q.get('file'));
  return { autoRun: q.get('check') === '1' || autoTamper !== null || file !== null, autoTamper, startEditing: q.get('edit') === '1', demo: q.get('demo') === '1', file };
}

export function ProofPage() {
  const { file, ...way } = arrival(location.search);
  // An arena file is read before the checker mounts (the checker takes its first file once).
  const [source, setSource] = useState<ProofSource | null>(file === null ? { ...SAMPLES[0]! } : null);
  useEffect(() => {
    if (file === null) return;
    let live = true;
    const fallback = () => { if (live) setSource({ ...SAMPLES[0]! }); };
    void loadArenaBundle(file).then((text) => {
      if (!live) return;
      if (text === null) { fallback(); return; }
      setSource({ name: arenaBundleName(file), text, label: ARENA_PROOF.label(ATTACK_WORDS[file]?.title ?? file) });
    }, fallback);
    return () => { live = false; };
  }, [file]);
  return (
    <main className="pf-page">
      <header className="pf-head">
        <p className="kicker">{PROOF_CHECKER.page.back}</p>
        <h1 className="display">{PROOF_CHECKER.page.title}</h1>
        <p className="pf-lede">{PROOF_CHECKER.page.lede}</p>
        <p className="pf-watch">
          <a className="ui-btn sm" href={way.demo ? location.pathname : `${location.pathname}?demo=1`}>{way.demo ? PROOF_CHECKER.page.stop : PROOF_CHECKER.page.watch}</a>
        </p>
      </header>
      {source ? <ProofChecker key={source.name} source={source} samples={SAMPLES} own={AUTHORITY_MANIFEST} heading={false} lede={false} level={2} {...way} />
        : <p className="pf-lede" role="status">{ARENA_PROOF.loading}</p>}
    </main>
  );
}
