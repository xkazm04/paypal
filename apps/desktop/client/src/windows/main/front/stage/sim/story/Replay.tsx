// sim STORY: the practice deal, as a page in Stage's stage slot, drawn like ItemStage's "What
// happened" (time, who did what, price). It is a SIMULATED preview and says so on its face:
//
// Why not a real deal: the first-run world has no deals (mock/firstRun.ts buildFirstRunState), a
// table with the house is opened only by deal_join, which is privileged (approval window), and the
// mock has no driver that plays the house's counters after that (agent_start only records a run).
// So the offers are the house haggle the shipped practice agent RECORDED against the house seller's
// rule (mock/haggle.json via mock/haggle.ts, the same recording behind the sample week's D-0205):
// every price on this page comes from that file, none is typed here. The recording is loaded
// lazily so the sample data never sits in Main's first chunk.
//
// Her decision is kept in the story only (store.ts); nothing reaches the wallet.
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Module } from '@bindings/Module';
import { DUR, useCalm } from '../../../../../../design/motion';
import { formatMoney } from '../../../../../../lib/format';
import { Glyph } from '../../../../../../shared/modules';
import { Btn } from '../../../../../../shared/ui';
import { TRAVEL, tr } from '../../fx';
import { setStory, useStory } from './store';
import { STORY, type GoalId } from './words';

type Recorded = typeof import('../../../../../../mock/haggle');
type Haggle = Recorded['RECORDED_HAGGLE'];
type Step = Haggle['steps'][number];

/** One offer lands every two sheet lengths: slow enough to read, quick enough to watch. */
const BEAT_MS = DUR.sheet * 2;

const money = (minor: number): string => formatMoney({ minor, currency: 'USD' });

export function useRecording(): Haggle | null | 'failed' {
  const [rec, setRec] = useState<Haggle | null | 'failed'>(null);
  useEffect(() => {
    let dead = false;
    import('../../../../../../mock/haggle').then((m) => { if (!dead) setRec(m.RECORDED_HAGGLE); }, () => { if (!dead) setRec('failed'); });
    return () => { dead = true; };
  }, []);
  return rec;
}

export function Replay({ goal, onNext, show }: {
  goal: GoalId;
  onNext: () => void;
  /** Show a module in the side list (host.pick), pulsing it once. */
  show: (m: Module) => void;
}) {
  const rec = useRecording();
  const calm = useCalm();
  const { decision } = useStory();
  // The steps up to the moment the wallet held the agent's yes; after it, only her decision.
  const until = useMemo(() => {
    if (!rec || rec === 'failed') return [] as Step[];
    const i = rec.steps.findIndex((s) => s.act === 'refused');
    return i < 0 ? rec.steps : rec.steps.slice(0, i + 1);
  }, [rec]);
  const after = useMemo<Step[]>(() => {
    if (!rec || rec === 'failed' || !decision) return [];
    if (decision === 'walk') return [{ by: 'owner', act: 'withdraw', price: 0 }];
    return rec.steps.slice(until.length);
  }, [rec, decision, until.length]);
  // Ticking: one more step every beat; calm (reduced motion) shows them all at once. A decision
  // already taken (a reload) shows the whole story.
  const [shown, setShown] = useState(0);
  const all = calm || decision !== null;
  useEffect(() => {
    if (all || shown >= until.length) return;
    const t = setTimeout(() => setShown((n) => n + 1), shown === 0 ? DUR.slow : BEAT_MS);
    return () => clearTimeout(t);
  }, [all, shown, until.length]);
  const visible = all ? until : until.slice(0, shown);
  const atDecision = until.length > 0 && visible.length === until.length;

  if (rec === null || rec === 'failed') {
    return (
      <div className="ss-page">
        <p className="ss-quiet">{rec === null ? STORY.dealLoading : STORY.dealUnread}</p>
      </div>
    );
  }
  const last = until[until.length - 1];
  const held = last?.act === 'refused' ? last.price : rec.outcome.price;
  const rows = [...visible, ...after];
  return (
    <div className="ss-page ss-deal" data-ss-deal={decision ?? (atDecision ? 'decide' : 'playing')}>
      <header className="ss-deal-h">
        <Glyph module="tables" className="ss-glyph" />
        <h1 className="ss-h">{STORY.dealTitle}</h1>
        <span className="ss-tag is-sim" title={STORY.dealTagTitle}>{STORY.dealTag}</span>
      </header>
      <p className="ss-quiet">{STORY.dealSub}</p>
      <section className="ss-sec" aria-label={STORY.dealHappened}>
        <h2 className="ss-kick">{STORY.dealHappened}</h2>
        <ol className="ss-tl" aria-live="polite">
          <AnimatePresence initial={false}>
            {rows.map((s, i) => (
              <motion.li key={`${i}:${s.by}:${s.act}`} className={`ss-tl-row by-${s.by}${s.act === 'refused' ? ' is-held' : ''}`}
                initial={{ opacity: 0, y: TRAVEL.tick }} animate={{ opacity: 1, y: 0 }} transition={tr('med', calm, 'out')}>
                <span className="ss-tl-n num">{i + 1}</span>
                <span className="ss-tl-said">
                  <b>{STORY.by[s.by]}</b> {STORY.act[s.act]}
                  {s.act === 'refused' ? <span className="ss-tl-why"> · {STORY.refusedWhy}</span> : null}
                </span>
                <span className="ss-tl-price num">{s.act === 'withdraw' ? '' : money(s.price)}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      </section>
      <AnimatePresence mode="wait" initial={false}>
        {atDecision && !decision ? (
          <motion.section key="decide" className="ss-decide" data-ss-decide
            initial={{ opacity: 0, y: TRAVEL.main }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={tr('slow', calm, 'out')}>
            <p className="ss-decide-lead">{STORY.decisionLead}</p>
            <p>{goal === 'askFirst' ? STORY.decisionWhyAsk(money(held)) : STORY.decisionWhy(money(held), money(rec.rules.ask_above))}</p>
            <div className="ss-acts">
              <Btn kind="gold" onClick={() => setStory({ decision: 'accept' })}>{STORY.decisionAccept(money(held))}</Btn>
              <Btn kind="plain" onClick={() => setStory({ decision: 'walk' })}>{STORY.decisionWalk}</Btn>
            </div>
            <p className="ss-quiet">{STORY.decisionNote}</p>
          </motion.section>
        ) : null}
        {decision ? (
          <motion.section key="result" className="ss-result" data-ss-result={decision}
            initial={{ opacity: 0, y: TRAVEL.main }} animate={{ opacity: 1, y: 0 }} transition={tr('slow', calm, 'out')}>
            <p className="ss-result-lead">{decision === 'accept' ? STORY.resultAgreed(money(rec.outcome.price)) : STORY.resultWalked}</p>
            <p>{STORY.resultWhere}</p>
            <ul className="ss-where">
              <li><Glyph module="tables" className="ss-glyph-sm" />{STORY.resultTables}<button type="button" className="linkbtn" onClick={() => show('tables')}>{STORY.seeTables}</button></li>
              <li><Glyph module="book" className="ss-glyph-sm" />{STORY.resultBook}<button type="button" className="linkbtn" onClick={() => show('book')}>{STORY.seeBook}</button></li>
            </ul>
            <p className="ss-quiet">{STORY.resultEmpty}</p>
            <div className="ss-acts"><Btn kind="primary" onClick={onNext}>{STORY.dealNext}</Btn></div>
          </motion.section>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

