import { useEffect, useState, type ReactNode } from 'react';
import { AUTHORITY_MANIFEST } from '@bindings/authority';
import { ATTACK_WORDS } from '../arena/model';
import { arenaBundleId, arenaBundleName, loadArenaBundle } from '../lib/proof/arenaBundles';
import { SAMPLES } from '../lib/proof/sample';
import { TAMPERS, type TamperId } from '../lib/proof/tamper';
import { PROOF_CHECKER } from '../lib/words';
import { ARENA_PROOF } from '../lib/words/arena';
import { ProofChecker, type ProofSource } from '../shared/proofcheck/ProofChecker';
// The console's reveal sequence (a no-op on the standalone page, which has no <Stagger>): the heading
// paints first, the checker (the heavy part) takes the next wave.
import { Reveal, Skeleton } from '../windows/main/console/stagger';

/** The standing marker, worded as the director's banner is: sample data, not the wallet. */
const SAMPLE_NOTE = 'Practice deal on sample data, not the wallet. Nothing here is a real payment; the checks themselves are real.';

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

/** `host="console"`: the console's place #p=proof (a layer heading, links that keep the hash). */
export function ProofPage({ host = 'page' }: { host?: 'page' | 'console' } = {}) {
  const inConsole = host === 'console';
  const here = inConsole ? `${location.pathname}%S#p=proof` : location.pathname;
  const link = (search: string) => here.replace('%S', search);
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
    <Shell inConsole={inConsole}>
      <header className="pf-head">
        <p className="kicker">{PROOF_CHECKER.page.back}</p>
        <h1 className={inConsole ? 'display cs-title' : 'display'} tabIndex={inConsole ? -1 : undefined} data-layer-title={inConsole ? '' : undefined}>{PROOF_CHECKER.page.title}</h1>
        <p className="pf-sample" role="note" data-proof-sample=""><span className="pf-dot" aria-hidden="true" />{SAMPLE_NOTE}</p>
        <p className="pf-lede">{PROOF_CHECKER.page.lede}</p>
        <p className="pf-watch">
          <a className="ui-btn sm" href={way.demo ? link('') : link('?demo=1')}>{way.demo ? PROOF_CHECKER.page.stop : PROOF_CHECKER.page.watch}</a>
        </p>
      </header>
      <Reveal wave={1} sizeKey="proof:checker" skeleton={<Skeleton h="62rem" />}>
        {source ? <ProofChecker key={source.name} source={source} samples={SAMPLES} own={AUTHORITY_MANIFEST} heading={false} lede={false} level={2} ownerChecklist {...way} />
          : <p className="pf-lede" role="status">{ARENA_PROOF.loading}</p>}
      </Reveal>
    </Shell>
  );
}

/** A page of its own is a <main>; inside the console (already a <main>) it is a plain block. */
function Shell({ inConsole, children }: { inConsole: boolean; children: ReactNode }) {
  return inConsole ? <div className="pf-page in-console">{children}</div> : <main className="pf-page">{children}</main>;
}
