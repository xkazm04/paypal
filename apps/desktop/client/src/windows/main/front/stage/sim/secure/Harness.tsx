// spark abstract-first-home round 4 - PROTOTYPE-ONLY scratch harness for the secure step (not shipped,
// not routed from the app). It puts one <SecureStep/> in a stand-in assistant turn so each presenter
// can be seen and screenshotted before the tour (sim/tour) consumes it. Mounted by a throwaway
// sc-harness.html (`?kind=keys|rules|pairing&secure=inline|sheet|popup&first_run=1`) that is created
// for a screenshot run and deleted after. `done` is read from the wallet as useStart reads it.
import { useEffect, useState } from 'react';
import type { H256 } from '@bindings/H256';
import { useMutation, useQuery } from '../../../../../../lib/hooks';
import { buildMandate } from '../../../../../approval/mandateDraft';
import { templateDraft } from '../../../../../approval/templates';
import type { SecureKind } from './contract';
import { SecureStep } from './SecureStep';
import './harness.css';

const LINE: Record<SecureKind, string> = {
  keys: 'Hi - three quick things and your agents can work. First, your PayPal sandbox keys.',
  rules: 'Next, the rules your agents follow. Here they are in plain words; sign them if they look right.',
  pairing: 'Last, meet the practice shop. Check that its four words match, then connect.',
};

/** The rules draft the tour would hand over: the careful starter, paying the practice shop. */
function practiceDraft(): string | null {
  const now = Math.floor(Date.now() / 1000);
  const b = buildMandate(templateDraft('careful', now, { payees: ['HOUSE'] }));
  return b.ok ? JSON.stringify({ type: 'rules', agent: 'shopper', not_before: b.notBefore, expires: b.expires, clauses: b.clauses }) : null;
}

export function Harness() {
  const q = new URLSearchParams(location.search);
  const kind = (['keys', 'rules', 'pairing'].includes(q.get('kind') ?? '') ? q.get('kind') : 'keys') as SecureKind;
  const settings = useQuery('get_settings', null, { refreshOn: ['settings:changed'] });
  const mandates = useQuery('mandate_list', null, { refreshOn: ['settings:changed'] });
  const cps = useQuery('counterparty_list', null, { refreshOn: ['pairing:pinned', 'settings:changed'] });
  const wake = useMutation('house_wake');
  const join = useMutation('pairing_join');
  const [pairing, setPairing] = useState<H256 | null>(null);
  const [draft] = useState(() => (kind === 'rules' ? (q.get('draft') ?? practiceDraft()) : null));
  const [cancelled, setCancelled] = useState(0);
  useEffect(() => {
    if (kind !== 'pairing' || pairing || !settings.data) return;
    void (async () => {
      if (settings.data?.house === 'idle') await wake.run(null);
      const r = await join.run({ code: 'HOUSE', side: 'buyer', payee: 'practice-buyer', peer: null });
      if (r) setPairing(r.pairing_id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, settings.data, pairing]);
  const done = kind === 'keys' ? !!settings.data?.payment_executor_configured
    : kind === 'rules' ? (mandates.data ?? []).length > 0
      : (cps.data ?? []).some((c) => c.house);
  const ready = kind !== 'pairing' || pairing !== null;
  return (
    <div className="sch">
      <div className="sch-col">
        <p className="sch-status">Today · nothing needs you yet · setting up</p>
        <div className="sch-turn">
          <span className="sch-who" aria-hidden="true">✦</span>
          <div className="sch-body">
            <p className="sch-step">{kind === 'keys' ? '1' : kind === 'rules' ? '2' : '3'} of 3</p>
            <p className="sch-say">{LINE[kind]}</p>
            {ready ? <SecureStep key={cancelled} kind={kind} draft={draft} pairing={pairing ? JSON.stringify(pairing) : null} done={done} onCancel={() => setCancelled((n) => n)} /> : <p className="sch-say">…</p>}
            <button type="button" className="sch-skip">Skip for now</button>
          </div>
        </div>
        <div className="sch-ask">Ask anything…</div>
      </div>
    </div>
  );
}
