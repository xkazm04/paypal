// The console's own layers (WP2, kept by the framework): the decision centre - or, on a brand-new
// wallet, the Charter as the first layer - and everything waiting. They are not code-split (the
// centre is the window's first paint) and they read the console's queue through `CentreHost`,
// which only Console.tsx provides. Not a WP3 area.
import { createContext, useContext } from 'react';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Module } from '@bindings/Module';
import { CENTRE_TITLE, CHARTER_TITLE, SEAL_RING, sealLabel, WAITING_TITLE } from '../../../../lib/words';
import { Seal } from '../../../../shared/brand';
import type { SetupStep } from '../../logic';
import { Charter } from '../../setup/Charter';
import { Centre, type CentreProps } from '../Centre';
import { defineLayer, type LayerProps } from '../layers';
import { Waiting } from '../Waiting';

/** What the centre and the waiting list read from the console (its queue and its handlers). */
export type CentreHostValue = {
  centre: CentreProps;
  charterStep: SetupStep | null;
  setCharterStep: (s: SetupStep | null) => void;
};
export const CentreHost = createContext<CentreHostValue | null>(null);
function useCentreHost(): CentreHostValue {
  const v = useContext(CentreHost);
  if (!v) throw new Error('a centre layer outside the console');
  return v;
}

function CentreLayer({ state }: LayerProps) {
  const h = useCentreHost();
  if (state.firstRun) {
    const p = h.centre.presence;
    const seal = <Seal state={p.state} progress={null} label={sealLabel(p.word, p.line)} ring={SEAL_RING} />;
    return <Charter root step={h.charterStep} onStep={h.setCharterStep} onDone={() => h.setCharterStep(null)} seal={seal} />;
  }
  return <Centre {...h.centre} />;
}

function WaitingLayer({ route, nav }: LayerProps) {
  const h = useCentreHost();
  const module: Module | undefined = route.level === 'waiting' ? route.module : undefined;
  return (
    <Waiting queue={h.centre.queue as readonly AttentionItem[]} module={module} onPick={nav.need}
      onFilter={(m) => nav.go(m ? { level: 'waiting', module: m } : { level: 'waiting' }, { replace: true })} />
  );
}

export const layers = [
  defineLayer({ id: 'centre', component: CentreLayer, title: () => CENTRE_TITLE, tone: 'var(--gold)', fit: true }),
  defineLayer({ id: 'waiting', component: WaitingLayer, title: () => WAITING_TITLE, tone: 'var(--gold)', fit: true }),
];
/** The centre's name on a brand-new wallet (the Charter stands in for it). */
export const FIRST_RUN_TITLE = CHARTER_TITLE;
