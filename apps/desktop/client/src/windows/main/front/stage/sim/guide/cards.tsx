// The GUIDE's inline cards: what host.say puts under a turn. Each card is a component with its own
// hooks, so it stays live in Stage's transcript (progress from useStart, the guide's phase from the
// store) long after the turn was said. A step happens IN its card:
//   paypal    the real approval page (SecureStep) - set_credentials is privileged
//   rules     a first sentence picked here, read by the fixed-word reader (lib/say, no model), and
//             the real approval page's rules editor pre-filled with it - mandate_sign is privileged
//   practice  house_wake + pairing_join HOUSE here (main commands), then the four words in the real
//             approval page - pairing_confirm is privileged
//   engine    the agent app picker Stage already has (SetupCard 'engine': engine_select, main)
import { motion } from 'framer-motion';
import { useEffect, useState, type ReactNode } from 'react';
import type { H256 } from '@bindings/H256';
import { useCalm } from '../../../../../../design/motion';
import type { GettingStarted } from '../../../../../../lib/firstRun';
import { useMutation } from '../../../../../../lib/hooks';
import { blockedBy, plainWords } from '../../../../../../lib/say/draft';
import { sayState, saySet } from '../../../../../../lib/say/store';
import { START_STEP, type StartStepKey } from '../../../../../../lib/words';
import { SAY } from '../../../../../../lib/words/say';
import { WalletNotice } from '../../../../../../shared/honesty';
import { Btn, Field, Icon } from '../../../../../../shared/ui';
import { canSubmit, payeeProblem } from '../../../../setup/pairing';
import { useStart } from '../../../../setup/start';
import { useSayReading } from '../../../../setup/useSay';
import { useSettings } from '../../../../world';
import { tr } from '../../fx';
import { SetupCard } from '../../SetupInline';
import { guideN, guideSteps } from './order';
import { useGuide, type GuideCtl, type StepCardProps } from './store';
import { SecureStep } from './SecureStep';
import { SG, SG_STEP } from './words';

/** A card arriving under its turn. */
function Arrive({ className, children, ...data }: { className: string; children: ReactNode } & Record<`data-${string}`, string>) {
  const calm = useCalm();
  return (
    <motion.article className={className} {...data} initial={calm ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={tr('med', calm, 'out')}>
      {children}
    </motion.article>
  );
}

/** Steps done of total, as four marks (from useStart: the world, never a reply). */
export function Progress({ gs, list = false }: { gs: GettingStarted; list?: boolean }) {
  return (
    <div className={`sg-prog${list ? ' is-list' : ''}`} role="group" aria-label={SG.progressLabel}>
      <ol className="sg-prog-marks">
        {guideSteps(gs).map((s) => (
          <li key={s.key} className={`sg-mark is-${s.state}`} data-sg-mark={s.key} data-state={s.state}>
            <span className="sg-dot" aria-hidden="true">{s.state === 'done' ? <Icon name="check" size={11} /> : s.n}</span>
            {list ? <span className="sg-mark-t">{START_STEP[s.key].title}</span> : <span className="sg-sr">{START_STEP[s.key].title}</span>}
          </li>
        ))}
      </ol>
      <span className="sg-prog-n" data-sg-progress={`${gs.done}/${gs.total}`}>{SG.progress(gs.done, gs.total)}</span>
    </div>
  );
}

/** The opening turn's card: the four steps, Start (or Continue) and Skip for now. */
export function PlanCard({ ctl }: { ctl: GuideCtl }) {
  const g = useGuide();
  const gs = useStart();
  return (
    <Arrive className="sg-card is-plan" data-sg-card="plan">
      <p className="fs-body">{SG.planLead}</p>
      <Progress gs={gs} list />
      <p className="fs-quiet">{SG.planAsk}</p>
      {g.phase === 'intro' ? (
        <div className="fs-acts">
          <Btn kind="gold" onClick={ctl.start}>{gs.done ? SG.continue : SG.start}</Btn>
          <Btn kind="plain" onClick={ctl.skip} title={SG.skipTitle}>{SG.skip}</Btn>
        </div>
      ) : null}
    </Arrive>
  );
}

/** One step, done in place. An older card of the same step folds to a line once a newer one is said. */
export function StepCard({ step, serial, ctl }: StepCardProps) {
  const g = useGuide();
  const gs = useStart();
  const n = guideN(step);
  if (gs.steps.find((s) => s.key === step)?.state === 'done') {
    return (
      <div className="fs-step is-done" data-sg-card="step" data-sg-step={step} data-state="done">
        <span className="fs-step-mark" aria-hidden="true"><Icon name="check" size={13} /></span>
        <span>{START_STEP[step].done}</span>
      </div>
    );
  }
  if (g.live !== serial || (g.phase !== 'step' && g.phase !== 'paused')) {
    return <p className="fs-quiet sg-folded" data-sg-card="folded">{g.phase === 'paused' && g.live === serial ? SG.pausedHere : SG.movedBelow}</p>;
  }
  const paused = g.phase === 'paused';
  return (
    <Arrive className={`sg-card is-step${paused ? ' is-paused' : ''}`} data-sg-card="step" data-sg-step={step} data-state="todo" data-sg-live={String(serial)}>
      <header className="sg-card-h">
        <span className="fs-kick">{SG.stepOf(n, gs.total)}</span>
        <b className="sg-card-t">{START_STEP[step].title}</b>
        <Progress gs={gs} />
      </header>
      {paused ? <p className="fs-quiet">{SG.pausedHere}</p> : <StepBody step={step} />}
      {paused ? null : (
        <footer className="sg-card-f">
          <button type="button" className="fs-chip" onClick={() => ctl.ask(SG.ask[step])}>{SG.ask[step]}</button>
          <span className="ui-spacer" />
          <Btn sm kind="plain" onClick={ctl.skip} title={SG.skipTitle}>{SG.skip}</Btn>
        </footer>
      )}
    </Arrive>
  );
}

function StepBody({ step }: { step: StartStepKey }) {
  if (step === 'paypal') return <KeysBody />;
  if (step === 'rules') return <RulesBody />;
  if (step === 'practice') return <PracticeBody />;
  return <EngineBody />;
}

function KeysBody() {
  return (
    <>
      <p className="fs-body">{SG.keysBody}</p>
      <SecureStep args={{ deal_id: null, target: 'credentials' }} what={SG_STEP.paypal} act={SG.secureOpen}>
        <p className="fs-quiet">{SG.keysSecret}</p>
      </SecureStep>
    </>
  );
}

/** Three ready sentences (the Say it box's own examples); the reading is the fixed-word reader's. */
const RULE_LINES = SAY.tryLines.slice(0, 3);

function RulesBody() {
  const said = useSayReading();
  useEffect(() => { if (!sayState().text) saySet(RULE_LINES[0] ?? ''); }, []);
  const sentence = said.reading && !blockedBy(said.reading) ? plainWords(said.chips) : '';
  return (
    <>
      <p className="fs-body">{SG.rulesBody}</p>
      <div className="sg-picks" role="group" aria-label={SG.rulesPick}>
        {RULE_LINES.map((l) => (
          <button key={l} type="button" className="sg-pick" aria-pressed={said.text === l} onClick={() => saySet(l)}>{l}</button>
        ))}
      </div>
      {said.text ? (sentence && said.rules
        ? <p className="sg-read"><span className="fs-kick">{SG.rulesRead}</span> {sentence}</p>
        : <p className="fs-quiet">{SG.rulesNone}</p>) : null}
      <SecureStep key={said.text} args={{ deal_id: null, target: 'mandate', draft: said.rules ? { type: 'rules', ...said.rules } : null }}
        what={SG_STEP.rules} act={SG.rulesAct} ready={!!said.rules} />
    </>
  );
}

function PracticeBody() {
  const house = useSettings().data?.house ?? null;
  const wake = useMutation('house_wake');
  const join = useMutation('pairing_join');
  const [payee, setPayee] = useState('');
  const [pairing, setPairing] = useState<{ id: H256; words: string[] } | null>(null);
  const problem = payeeProblem(payee);
  const busy = wake.pending || join.pending;
  const go = async () => {
    if (!house || !canSubmit('house', { payee, code: '' }, house)) return;
    if (house === 'idle' && (await wake.run(null)) === undefined) return;
    const r = await join.run({ code: 'HOUSE', side: 'buyer', payee: payee.trim(), peer: null });
    if (r) setPairing({ id: r.pairing_id, words: r.words });
  };
  if (house === 'unavailable') return <p className="fs-body">{SG.practiceUnavailable}</p>;
  if (pairing) {
    return (
      <>
        <p className="fs-body">{SG.practiceWords}</p>
        <p className="sg-words">{pairing.words.map((w) => <span key={w} className="sg-word">{w}</span>)}</p>
        <SecureStep args={{ deal_id: null, pairing: pairing.id }} what={SG_STEP.practice} act={SG.secureOpen} auto />
      </>
    );
  }
  return (
    <>
      <p className="fs-body">{SG.practiceBody}</p>
      <form className="sg-payee" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <label htmlFor="sg-payee" className="fs-kick">{SG.practicePaid}</label>
        <Field id="sg-payee" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder={SG.practicePaidHint} autoComplete="off" spellCheck={false}
          aria-invalid={problem ? true : undefined} />
        <div className="fs-acts">
          <Btn kind="gold" type="submit" disabled={busy || !house || !canSubmit('house', { payee, code: '' }, house)}>{wake.pending ? SG.practiceWaking : SG.practiceAct}</Btn>
        </div>
      </form>
      {wake.error ? <WalletNotice error={wake.error} what={SG.practiceWhat} /> : null}
      {join.error ? <WalletNotice error={join.error} what={SG.practiceWhat} /> : null}
    </>
  );
}

function EngineBody() {
  // Stage's own agent app picker (engine_status / engine_select): reused as it is.
  return <SetupCard step="engine" done={false} opened={false} onOpened={() => undefined} />;
}

/** After Skip for now: where the guide waits, with Continue setup. */
export function ContinueCard({ ctl }: { ctl: GuideCtl }) {
  const g = useGuide();
  const gs = useStart();
  return (
    <Arrive className="sg-card is-continue" data-sg-card="continue">
      <Progress gs={gs} />
      {g.phase === 'paused' ? (
        <div className="fs-acts"><Btn kind="gold" onClick={ctl.resume}>{SG.continue}</Btn></div>
      ) : null}
    </Arrive>
  );
}

/** The ending: you're set up, what you have, and the way into the normal home. */
export function DoneCard({ ctl }: { ctl: GuideCtl }) {
  const g = useGuide();
  const gs = useStart();
  return (
    <Arrive className="sg-card is-done" data-sg-card="done">
      <p className="fs-body">{SG.doneLead}</p>
      <Progress gs={gs} list />
      <ul className="fs-lines">{SG.doneWhere.map((l) => <li key={l}>{l}</li>)}</ul>
      {g.phase === 'done' ? (
        <div className="fs-acts">
          <Btn kind="gold" onClick={ctl.home} title={SG.homeTitle}>{SG.home}</Btn>
          <Btn kind="plain" onClick={ctl.leave} title={SG.leaveTitle}>{SG.leave}</Btn>
        </div>
      ) : null}
    </Arrive>
  );
}

/** Under an answer while a secure step is open above: saying the step again would drop what she is
 *  doing in it, so this only offers the way back to it. */
export function JumpCard({ step, serial }: { step: StartStepKey; serial: number }) {
  const g = useGuide();
  const calm = useCalm();
  if (g.phase !== 'step' || g.live !== serial) return null;
  const go = () => document.querySelector(`[data-sg-live="${serial}"]`)?.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' });
  return <button type="button" className="fs-chip" data-sg-card="jump" onClick={go}>{SG.jump(START_STEP[step].title)}</button>;
}
