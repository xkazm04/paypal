// "Check this proof": a deal's signed proof file checked in the browser, line by line, then broken on
// purpose. The checker (lib/proof) is the wallet verifier's twin, so a line here is the line the
// wallet would show. The person can press a tamper button, or change the file's text themselves, and
// see exactly which checks notice. Used on the deal page, on a page of its own (proof.html) and in the
// Book; the file never leaves the page.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent } from 'react';
import { formatMoney } from '../../lib/format';
import { applyEdits } from '../../lib/proof/edits';
import { fromView, placesIn, toFile, toView, type Place } from '../../lib/proof/fileText';
import { locate } from '../../lib/proof/locate';
import { fingerprint } from '../../lib/proof/fingerprint';
import { CHECK_IDS, type CheckLine } from '../../lib/proof/checks';
import { editsFor, type TamperId } from '../../lib/proof/tamper';
import { NOT_A_PROOF } from '../../lib/proof/read';
import { writtenWrong } from '../../lib/proof/text';
import { PROOF_FILE_LIMIT, readProofFile, TOO_LARGE } from '../../lib/proof/verify';
import { isCalm } from '../../design/motion';
import { modeWord, PROOF_ALL_THAT_APPLY, PROOF_CAUGHT, PROOF_CHECKER as W, PROOF_SHORT, PROOF_CHECKS, PROOF_SOME_UNCHECKED, PROOF_VERSION_MATCH, PERMISSIONS_FINGERPRINT, TAMPER_WORDS, TAMPERS_SHOWN } from '../../lib/words';
import { KeyId } from '../ownerKey';
import { Btn, Chip, Kv, Seg } from '../ui';
import { caption, changed, dashedWords, kindOf, reportText } from './describe';
import { SidesCard } from './SidesCard';
import { useProofRun, type Facts, type RunState } from './useProofRun';
import './proofcheck.css';

export interface ProofSource {
  name: string;
  text: string;
  /** The practice deal the preview ships. */
  sample?: boolean;
  /** A few words naming a practice deal in the picker. */
  label?: string;
  /** What happened in it. */
  story?: string;
}

const parse = (text: string): unknown => {
  try {
    const document: unknown = JSON.parse(text);
    // A file the wallet would not read is shown (and refused) as the text it is, not tidied into one it would.
    return writtenWrong(text) ? null : document;
  } catch {
    return null;
  }
};
const SIXTEEN = CHECK_IDS.length;

export function ProofChecker({ source, samples = [], own, heading = true, lede = true, level = 3, autoRun = false, autoTamper = null, startEditing = false, demo = false }: {
  source: ProofSource;
  /** The practice deals, to pick between (and to go back to after a file of the person's own). */
  samples?: readonly ProofSource[];
  /** The permissions fingerprint of the app doing the checking. */
  own: string | null;
  /** False when the surrounding sheet already names it. */
  heading?: boolean;
  /** False when the page around it already says what this is: only the privacy line is kept. */
  lede?: boolean;
  /** The heading level of its sections: 3 under a sheet's title, 2 under a page's. */
  level?: 2 | 3;
  /** Check the file as soon as the page is up (a link made for showing it). */
  autoRun?: boolean;
  /** And then break it this way. */
  autoTamper?: TamperId | null;
  /** Open on editing the file's text. */
  startEditing?: boolean;
  /** Play it through by itself, for a recording: check it, break it a few ways, put it back each time. */
  demo?: boolean;
}) {
  const H = `h${level}` as 'h2' | 'h3';
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const [file, setFile] = useState<ProofSource>(source);
  const original = useMemo(() => parse(file.text), [file.text]);
  const [tamper, setTamper] = useState<TamperId | null>(null);
  /** The file being checked: the original, or the original with one tamper or the person's own edit. */
  const [current, setCurrent] = useState<unknown>(original);
  const [draft, setDraft] = useState<string>(() => (original === null ? file.text : toView(original)));
  const [by, setBy] = useState<'none' | 'button' | 'hand'>('none');
  const [notJson, setNotJson] = useState(false);
  const [over, setOver] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const { state, start, reset } = useProofRun();
  // Once a file has been checked it can be broken, and stays breakable while it is checked again.
  const [hasChecked, setHasChecked] = useState(false);
  const [mode, setMode] = useState<'break' | 'edit'>(startEditing ? 'edit' : 'break');
  const [copied, setCopied] = useState<'ok' | 'no' | null>(null);
  /** The editor's text as last checked, so a change the program makes is not checked twice. */
  const checkedText = useRef(draft);
  /** Where to put the cursor once the editor shows the new text. */
  const pointTo = useRef<string | null>(null);
  useEffect(() => {
    if (state.phase === 'done') setHasChecked(state.refused === null);
  }, [state.phase, state.refused, state.run]);

  // A different file: everything starts again from it.
  useEffect(() => {
    const text = original === null ? file.text : toView(original);
    checkedText.current = text;
    setCurrent(original);
    setDraft(text);
    setTamper(null);
    setBy('none');
    setNotJson(false);
  }, [original, file.text]);

  const check = useCallback((doc: unknown, pace: 'first' | 'again') => start(doc === null ? file.text : JSON.stringify(doc, null, 2), pace), [start, file.text]);

  const load = useCallback(async (picked: File) => {
    setReadError(null);
    if (picked.size > PROOF_FILE_LIMIT) {
      reset();
      setReadError(TOO_LARGE);
      return;
    }
    try {
      const text = await readProofFile(picked);
      if (text === null) {
        reset();
        setReadError(NOT_A_PROOF);
        return;
      }
      setFile({ name: picked.name, text });
      const doc = parse(text);
      await start(doc === null ? text : JSON.stringify(doc, null, 2), 'first');
    } catch {
      setReadError(W.readFailed);
    }
  }, [reset, start]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const picked = e.dataTransfer.files[0];
    if (picked) void load(picked);
  };

  const applyTamper = (tid: TamperId) => {
    const edits = editsFor(tid, original);
    if (!edits) return;
    const doc = structuredClone(original);
    applyEdits(doc, edits);
    const text = toView(doc);
    checkedText.current = text;
    pointTo.current = edits[0]?.path ?? null;
    setTamper(tid);
    setBy('button');
    setNotJson(false);
    setCurrent(doc);
    setDraft(text);
    void check(doc, 'again');
  };
  const putBack = () => {
    const text = original === null ? file.text : toView(original);
    checkedText.current = text;
    setTamper(null);
    setBy('none');
    setNotJson(false);
    setCurrent(original);
    setDraft(text);
    void check(original, 'again');
  };
  /** Check the editor's text. Typing checks it once it is valid JSON; the button says so when it is not. */
  const checkEdited = (explicit = true) => {
    checkedText.current = draft;
    try {
      const doc = fromView(draft);
      setNotJson(false);
      setCurrent(doc);
      setTamper(null);
      setBy(JSON.stringify(doc) === JSON.stringify(original) ? 'none' : 'hand');
      void check(doc, 'again');
    } catch {
      setNotJson(true);
      if (!explicit) return;
      setCurrent(null);
      setBy('hand');
      void start('not json', 'again');
    }
  };
  const latest = useRef(checkEdited);
  latest.current = checkEdited;
  // The person types over the file and the checks follow, once they stop for a moment.
  useEffect(() => {
    if (mode !== 'edit' || draft === checkedText.current) return undefined;
    const timer = setTimeout(() => latest.current(false), isCalm() ? 0 : 450);
    return () => clearTimeout(timer);
  }, [draft, mode]);
  // Show where the file changed: the cursor goes to the changed value in the text.
  useEffect(() => {
    const area = editor.current;
    const path = pointTo.current;
    if (mode !== 'edit' || !area || !path) return;
    pointTo.current = null;
    const at = locate(draft, path);
    if (!at) return;
    area.setSelectionRange(at[0], at[1]);
    const line = draft.slice(0, at[0]).split('\n').length;
    area.scrollTop = Math.max(0, (line - 4) * (parseFloat(getComputedStyle(area).lineHeight) || 18));
  }, [draft, mode]);
  // A walk through it with no one at the keys (`?demo=1`): it uses the same controls a person does.
  const walk = useRef({ state, apply: applyTamper, back: putBack, run: () => check(original, 'first') });
  walk.current = { state, apply: applyTamper, back: putBack, run: () => check(original, 'first') };
  useEffect(() => {
    if (!demo) return undefined;
    let live = true;
    const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, isCalm() ? Math.min(ms, 120) : ms));
    const settled = async (after: number): Promise<void> => {
      while (live && !(walk.current.state.run > after && walk.current.state.phase === 'done')) await pause(80);
    };
    void (async () => {
      await pause(1200);
      let seen = walk.current.state.run;
      void walk.current.run();
      await settled(seen);
      await pause(2200);
      for (const way of ['price', 'signature', 'audit-gap', 'payee'] as const) {
        if (!live) return;
        seen = walk.current.state.run;
        walk.current.apply(way);
        await settled(seen);
        await pause(3200);
        seen = walk.current.state.run;
        walk.current.back();
        await settled(seen);
        await pause(1400);
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Deep links made for showing it: check on arrival, then break it.
  useEffect(() => {
    // (development mounts twice; the second run replaces the first)
    if (autoRun) void check(original, 'first');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const brokeIt = useRef(false);
  useEffect(() => {
    if (autoTamper && hasChecked && !brokeIt.current) {
      brokeIt.current = true;
      applyTamper(autoTamper);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasChecked]);
  const jump = (place: Place) => {
    const at = placesIn(draft)[place];
    const area = editor.current;
    if (!at || !area) return;
    area.focus({ preventScroll: true });
    area.setSelectionRange(at[0], at[1]);
    const line = draft.slice(0, at[0]).split('\n').length;
    area.scrollTop = Math.max(0, (line - 4) * (parseFloat(getComputedStyle(area).lineHeight) || 18));
  };
  const save = () => {
    const text = current === null ? draft : toFile(current);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = by === 'none' ? file.name : file.name.replace(/(\.tableproof)?$/, '-tampered.tableproof');
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const edits = tamper ? editsFor(tamper, original) : null;
  // Only the ways of breaking this file that it has something to break in.
  const shown = useMemo(() => TAMPERS_SHOWN.filter((tid) => editsFor(tid, original) !== null), [original]);
  const made = state.made;
  const bad = state.lines.flatMap((l, i) => (l && kindOf(l) === 'bad' ? [i] : []));
  const firstBad = bad[0] ?? -1;
  const dashed = state.lines.filter((l) => l && kindOf(l) === 'dashed').length;
  const running = state.phase === 'running';
  const places = useMemo(() => placesIn(draft), [draft]);

  const everChecked = hasChecked || (state.phase === 'done' && state.refused === null);
  const caughtBy = bad.map((i) => CHECK_IDS[i] ?? '');
  const goTo = (cid: string) => {
    const row = document.getElementById(`${id}-row-${cid}`);
    row?.scrollIntoView({ block: 'nearest', behavior: isCalm() ? 'auto' : 'smooth' });
    row?.querySelector('summary')?.focus({ preventScroll: true });
  };
  const fileName = by === 'none' ? file.name : file.name.replace(/(\.tableproof)?$/, '-tampered.tableproof');
  const verdictWord = bad.length > 0 ? W.failed : state.verified === true ? PROOF_ALL_THAT_APPLY : PROOF_SOME_UNCHECKED;
  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(reportText(fileName, state.lines, verdictWord));
      setCopied('ok');
    } catch {
      setCopied('no');
    }
  };

  return (
    <div className={`pk${over ? ' over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false); }} onDrop={onDrop}>
      {heading ? (
        <header className="pk-head">
          <h2>{W.title}</h2>
          <p>{W.intro}</p>
        </header>
      ) : lede ? <p className="pk-lede">{W.intro}</p> : null}
      <div className="pk-grid">
        <section className="pk-checks" aria-labelledby={`${id}-checks`}>
          <div className="pk-top">
            <H id={`${id}-checks`} className="pk-h">{W.checksHead}</H>
            {file.sample && file.story ? <p className="ui-hint pk-story">{file.story}</p> : null}
            <Verdict state={state} made={made} bad={bad.length} dashed={dashed} caught={caughtBy.map((cid) => PROOF_SHORT[cid] ?? cid)} onRun={() => void check(current, 'first')} />
            {by !== 'none' ? (
              <p className="pk-changed" role="status">
                <span>{W.changed}</span>{' '}
                <b>{by === 'button' && tamper ? TAMPER_WORDS[tamper].what : changed(original, current)}</b>
                {by === 'button' && edits ? <span className="dim"> · {caption(tamper as TamperId, original, edits)}</span> : null}
                <Btn sm kind="plain" onClick={putBack}>{W.undo}</Btn>
              </p>
            ) : null}
            {state.phase === 'done' && caughtBy.length > 0 ? (
              <p className="pk-caught">
                <span>{W.caughtBy}</span>
                {caughtBy.map((cid) => <Chip key={cid} tone="red" onClick={() => goTo(cid)} title={PROOF_CHECKS[cid]}>{PROOF_SHORT[cid] ?? cid}</Chip>)}
              </p>
            ) : null}
            {state.phase === 'done' && state.refused === null ? (
              <p className="pk-copy">
                <Btn sm kind="plain" onClick={() => void copyReport()}>{W.copy}</Btn>{' '}
                <span role="status" aria-live="polite">{copied === 'ok' ? W.copied : copied === 'no' ? W.noCopy : ''}</span>
              </p>
            ) : null}
          </div>
          <ol className="pk-list">
            {CHECK_IDS.map((cid, i) => (
              <Row key={cid} rowId={`${id}-row-${cid}`} id={cid} line={state.lines[i] ?? null} before={state.before?.[i] ?? null} current={running && made === i} stale={running && i >= made && state.before !== null} first={i === firstBad} run={state.run} />
            ))}
          </ol>
          {state.facts && !state.facts.signatures ? <p className="pk-refused" role="alert">{W.noSignatures}</p> : null}
          {state.refused ? <p className="pk-refused" role="alert">{state.refused}</p> : null}
          {readError ? <p className="pk-refused" role="alert">{readError}</p> : null}
          <H className="pk-h pk-sub">{W.howHead}</H>
          <ul className="pk-how">{W.how.map((t) => <li key={t}>{t}</li>)}</ul>
          <H className="pk-h pk-sub">{W.limitsHead}</H>
          <ul className="pk-limits">{W.limits.map((t) => <li key={t}>{t}</li>)}</ul>
        </section>
        <aside className="pk-file" aria-label={W.fileHead}>
          <H id={`${id}-tamper`} className="pk-h">{W.tamperHead}</H>
          <Seg value={mode} onChange={(m) => { setMode(m); if (m === 'edit' && !pointTo.current) pointTo.current = tamper ? (edits?.[0]?.path ?? null) : '/deal/terms/unit_price/minor'; }} label={W.tamperHead}
            options={[{ value: 'break', label: W.modeBreak }, { value: 'edit', label: W.modeEdit }]} className="pk-seg" />
          {mode === 'break' ? (
            <>
              <p className="ui-hint">{everChecked ? W.tamperIntro : W.tamperFirst}</p>
              <div className="pk-tampers" role="group" aria-label={W.modeBreak}>
                {shown.map((tid) => {
                  const e = editsFor(tid, original);
                  const w = TAMPER_WORDS[tid];
                  return (
                    <button key={tid} type="button" className="pk-tamper" aria-pressed={tamper === tid} disabled={!e || !everChecked} aria-disabled={running || undefined} onClick={() => { if (!running) applyTamper(tid); }}>
                      <b>{w.label}</b>
                      <span>{e ? caption(tid, original, e) : w.what}</span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="pk-edit">
              <label htmlFor={`${id}-text`} className="pk-label">{W.editLabel}</label>
              <p className="ui-hint" id={`${id}-hint`}>{W.editHint}</p>
              <div className="pk-jumps" role="group" aria-label={W.jump}>
                {(Object.keys(W.jumpTo) as Place[]).map((p) => (
                  <Btn key={p} sm kind="plain" disabled={!places[p]} onClick={() => jump(p)}>{`${W.jump} ${W.jumpTo[p]}`}</Btn>
                ))}
              </div>
              <textarea id={`${id}-text`} ref={editor} className="pk-text mono" spellCheck={false} wrap="off" rows={16} value={draft} aria-describedby={`${id}-hint`}
                onChange={(e) => setDraft(e.target.value)} />
              <p className="ui-hint" aria-live="polite">{notJson ? W.notJson : W.live}</p>
              <Btn sm aria-disabled={running || undefined} onClick={() => { if (!running) checkEdited(); }}>{W.checkEdited}</Btn>
            </div>
          )}

          <H className="pk-h pk-sub" id={`${id}-file`}>{W.fileHead}</H>
          <div className="pk-card">
            <div className="pk-name">
              <span className="mono">{fileName}</span>
              <span className="dim">{W.sizeOf(new Blob([current === null ? draft : toFile(current)]).size)}</span>
              {file.sample ? <Chip tone="dashed">{W.sampleKicker}</Chip> : null}
            </div>
            {file.sample ? <p className="ui-hint">{W.sample}</p> : null}
            <div className="pk-acts">
              <Btn sm onClick={save}>{W.save}</Btn>
              <Btn sm onClick={() => input.current?.click()}>{W.open}</Btn>
              <input ref={input} type="file" accept=".tableproof,.json,application/json" className="sr-only" tabIndex={-1} aria-hidden="true"
                onChange={(e) => { const picked = e.target.files?.[0]; if (picked) void load(picked); e.target.value = ''; }} />
            </div>
            <p className="ui-hint">{W.dropHint}</p>
            {samples.length > 1 || (samples.length === 1 && !file.sample) ? (
              <div className="pk-practice" role="group" aria-label={W.practiceHead}>
                <span className="dim">{W.practiceHead}</span>
                {samples.map((x) => (
                  <Btn key={x.name} sm kind="plain" aria-pressed={file.name === x.name && by === 'none'} onClick={() => { setFile(x); reset(); setHasChecked(false); }}>{x.label ?? x.name}</Btn>
                ))}
              </div>
            ) : null}
            {state.facts ? <FactsBlock facts={state.facts} own={own} /> : null}
          </div>
        </aside>
      </div>
      {everChecked ? <SidesCard mine={state.phase === 'done' ? state.side : null} candidates={samples.filter((x) => x.name !== file.name)} own={own} headingLevel={level} /> : null}
      <div className="pk-drop" aria-hidden="true"><span>{W.dropNow}</span></div>
    </div>
  );
}

function Verdict({ state, made, bad, dashed, caught, onRun }: { state: RunState; made: number; bad: number; dashed: number; caught: string[]; onRun: () => void }) {
  const running = state.phase === 'running';
  const done = state.phase === 'done';
  const refused = done && state.refused !== null;
  const failed = done && !refused && bad > 0;
  const passed = done && !refused && state.verified === true;
  const unmade = done && !refused && !failed && !passed;
  const word = refused ? W.failed : failed ? W.failed : passed ? PROOF_ALL_THAT_APPLY : unmade ? PROOF_SOME_UNCHECKED : running ? W.running : W.idle;
  const why = refused ? '' : failed ? W.failedWhy(bad) : passed ? W.passedWhy(dashed) : unmade ? W.passedWhy(dashed) : running ? W.progress(made, SIXTEEN) : '';
  return (
    <div className={`pk-verdict ${refused || failed ? 'bad' : passed ? 'ok' : ''}`}>
      <div className="pk-vmain">
        <span className="pk-vword" aria-hidden="true">
          {passed ? <Chip tone="ok">{word}</Chip> : refused || failed ? <Chip tone="red">{word}</Chip> : unmade ? <Chip tone="gold">{word}</Chip> : <Chip tone="dashed">{word}</Chip>}
        </span>
        {running ? <span className="pk-bar" aria-hidden="true"><i className="pk-fill" style={{ width: `${(made / SIXTEEN) * 100}%` }} /></span> : null}
        {why ? <span className="pk-why" aria-hidden="true">{why}</span> : null}
      </div>
      <Btn kind={done || running ? 'default' : 'primary'} aria-disabled={running || undefined} onClick={running ? undefined : onRun}>
        {running ? W.running : done ? W.rerun : W.run}
      </Btn>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{done ? `${word}. ${why}${caught.length ? ` ${W.caughtBy}: ${caught.join(', ')}.` : ''}` : ''}</span>
    </div>
  );
}

function Row({ id, rowId, line, before, current, stale, first, run }: { id: string; rowId: string; line: CheckLine | null; before: CheckLine | null; current: boolean; stale: boolean; first: boolean; run: number }) {
  const kind = line ? kindOf(line) : null;
  // A line that holds still stays put; the one that changes is the one that moves.
  const moved = before !== null && line !== null && !stale && kindOf(before) !== kind;
  const words = PROOF_CHECKS[id] ?? 'A check this page does not know.';
  const state = kind ?? (current ? 'now' : 'wait');
  const still = before !== null && !moved;
  const sr = kind === 'ok' ? W.sr.passed : kind === 'bad' ? W.sr.failed : kind === 'dashed' ? W.sr.unchecked : '';
  return (
    <li id={rowId} className={`pk-row ${state}${first ? ' first' : ''}${current && before ? ' scan' : ''}${stale ? ' stale' : ''}${still ? ' still' : ''}`} key={`${id}-${before === null || moved ? run : 'same'}`} data-check={id} aria-current={current ? 'step' : undefined}>
      <span className="pk-mark" aria-hidden="true">{kind === 'ok' ? '✓' : kind === 'bad' ? '✗' : kind === 'dashed' ? '–' : ''}</span>
      <div className="pk-body">
        {line ? (
          <details open={kind === 'bad' || undefined}>
            <summary><span className="sr-only">{sr}. </span>{words}{first ? <Chip tone="red" className="pk-first">{W.first}</Chip> : null}</summary>
            {kind === 'dashed' ? <p className="pk-note">{dashedWords(line)}</p> : null}
            {kind === 'bad' ? <p className="pk-note bad"><b>{W.caught}:</b> {PROOF_CAUGHT[id]}</p> : null}
            <p className="pk-detail mono"><span className="dim">{W.checkerSaid}: </span>{line.detail}</p>
          </details>
        ) : <span className="pk-pending">{words}</span>}
      </div>
    </li>
  );
}

function FactsBlock({ facts, own }: { facts: Facts; own: string | null }) {
  const print = fingerprint(facts.owner_key_id);
  const same = facts.authority_manifest === null ? null : facts.authority_manifest === own;
  return (
    <Kv className="pk-facts" items={[
      ['Price', <b className="money" key="p">{formatMoney({ minor: facts.price.minor, currency: facts.price.currency } as Parameters<typeof formatMoney>[0])}{facts.qty > 1 ? ` × ${facts.qty}` : ''}</b>],
      facts.payee ? ['Paid to', <span className="mono" key="to">{facts.payee}</span>] : null,
      ['Mode', modeWord(facts.mode as Parameters<typeof modeWord>[0])],
      [W.keyHead, facts.owner_key_id === 'invalid' ? <Chip tone="red" key="k">not a valid key</Chip> : (
        <div className="pk-key" key="k">
          <KeyId id={facts.owner_key_id} cols={4} />
          {print ? (
            <p className="pk-print" aria-label={`${W.keyByEye}: ${print.words.join(' ')}`}>
              {print.colours.map((c, i) => <i key={i} className={`fp fp-${c}`} aria-hidden="true" />)}
              <span>{print.words.join(' · ')}</span>
            </p>
          ) : null}
          <p className="ui-hint">{W.keyAnchor}</p>
        </div>
      )],
      facts.authority_manifest ? [PERMISSIONS_FINGERPRINT, (
        <span key="m" className="pk-ver">
          <span className="mono">{facts.authority_manifest.slice(0, 16)}…</span>
          {same !== null ? <span className={`pc-match ${same ? 'mine' : 'other'}`}>{same ? '✓ ' : ''}{PROOF_VERSION_MATCH[same ? 'same' : 'other']}</span> : null}
        </span>
      )] : null,
    ]} />
  );
}

