// "Check this proof": a deal's signed proof file checked in the browser, line by line, then broken on
// purpose. The checker (lib/proof) is the wallet verifier's twin, so a line here is the line the
// wallet would show. The person can press a tamper button, or change the file's text themselves, and
// see exactly which checks notice. Used on the deal page, on a page of its own (proof.html) and in the
// Book; the file never leaves the page.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent } from 'react';
import { formatMoney } from '../../lib/format';
import { applyEdits, readAt } from '../../lib/proof/edits';
import { fromView, placesIn, toFile, toView, type Place } from '../../lib/proof/fileText';
import { fingerprint } from '../../lib/proof/fingerprint';
import { CHECK_IDS, type CheckLine } from '../../lib/proof/checks';
import { editsFor, type TamperId } from '../../lib/proof/tamper';
import { PROOF_FILE_LIMIT, TOO_LARGE } from '../../lib/proof/verify';
import { isCalm } from '../../design/motion';
import { modeWord, PROOF_ALL_THAT_APPLY, PROOF_CAUGHT, PROOF_CHECKER as W, PROOF_SHORT, PROOF_CHECKS, PROOF_NOT_APPLICABLE, PROOF_NOT_CHECKED, PROOF_SOME_UNCHECKED, PROOF_VERSION_MATCH, PERMISSIONS_FINGERPRINT, TAMPER_WORDS, TAMPERS_SHOWN } from '../../lib/words';
import { KeyId } from '../ownerKey';
import { Btn, Chip, Kv } from '../ui';
import { useProofRun, type Facts, type RunState } from './useProofRun';
import './proofcheck.css';

export interface ProofSource {
  name: string;
  text: string;
  /** The practice deal the preview ships. */
  sample?: boolean;
}

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const SIXTEEN = CHECK_IDS.length;

/** The reason a dashed line is dashed: nothing of its kind in the deal, or a check not made. */
function dashedWords(line: CheckLine): string {
  if (!line.applies) return PROOF_NOT_APPLICABLE[line.id] ?? PROOF_CHECKER_OLDER;
  if (line.detail.includes('cannot check Ed25519')) return W.noEd25519;
  if (line.detail.includes('this page does not') || line.detail.includes('this page ran into')) return W.notYetBuilt;
  return PROOF_NOT_CHECKED;
}
const PROOF_CHECKER_OLDER = 'Not checked: files saved by older versions of the wallet don’t carry this record.';

type Kind = 'ok' | 'bad' | 'dashed';
const kindOf = (line: CheckLine): Kind => (line.ok ? 'ok' : line.checked && line.applies ? 'bad' : 'dashed');

/** Every place two files differ, as a path with what was there and what is there now. */
function changes(before: unknown, after: unknown, path = ''): Array<{ path: string; before: unknown; after: unknown }> {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
  if (object(before) && object(after) && Array.isArray(before) === Array.isArray(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].flatMap((k) => changes(before[k], after[k], `${path}/${k}`));
  }
  return [{ path, before, after }];
}
const brief = (v: unknown): string => {
  const text = typeof v === 'string' ? v : JSON.stringify(v) ?? '—';
  return text.length > 36 ? `${text.slice(0, 35)}…` : text;
};

export function ProofChecker({ source, sample, own, heading = true, lede = true }: {
  source: ProofSource;
  /** The practice deal, to go back to (the page of its own offers it). */
  sample?: ProofSource;
  /** The permissions fingerprint of the app doing the checking. */
  own: string | null;
  /** False when the surrounding sheet already names it. */
  heading?: boolean;
  /** False when the page around it already says what this is: only the privacy line is kept. */
  lede?: boolean;
}) {
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

  // A different file: everything starts again from it.
  useEffect(() => {
    setCurrent(original);
    setDraft(original === null ? file.text : toView(original));
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
      const text = await picked.text();
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
    setTamper(tid);
    setBy('button');
    setNotJson(false);
    setCurrent(doc);
    setDraft(toView(doc));
    void check(doc, 'again');
  };
  const putBack = () => {
    setTamper(null);
    setBy('none');
    setNotJson(false);
    setCurrent(original);
    setDraft(original === null ? file.text : toView(original));
    void check(original, 'again');
  };
  const checkEdited = () => {
    try {
      const doc = fromView(draft);
      setNotJson(false);
      setCurrent(doc);
      setTamper(null);
      setBy(JSON.stringify(doc) === JSON.stringify(original) ? 'none' : 'hand');
      void check(doc, 'again');
    } catch {
      setNotJson(true);
      setCurrent(null);
      setBy('hand');
      void start('not json', 'again');
    }
  };
  const jump = (place: Place) => {
    const at = placesIn(draft)[place];
    const area = editor.current;
    if (!at || !area) return;
    area.focus();
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
  const made = state.lines.filter(Boolean).length;
  const bad = state.lines.flatMap((l, i) => (l && kindOf(l) === 'bad' ? [i] : []));
  const firstBad = bad[0] ?? -1;
  const dashed = state.lines.filter((l) => l && kindOf(l) === 'dashed').length;
  const running = state.phase === 'running';
  const places = useMemo(() => placesIn(draft), [draft]);

  const everChecked = state.phase === 'done' && state.refused === null;
  const caughtBy = bad.map((i) => CHECK_IDS[i] ?? '');
  const goTo = (cid: string) => {
    const row = document.getElementById(`${id}-row-${cid}`);
    row?.scrollIntoView({ block: 'nearest', behavior: isCalm() ? 'auto' : 'smooth' });
    row?.querySelector('summary')?.focus({ preventScroll: true });
  };
  const fileName = by === 'none' ? file.name : file.name.replace(/(\.tableproof)?$/, '-tampered.tableproof');

  return (
    <div className={`pk${over ? ' over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false); }} onDrop={onDrop}>
      {heading ? (
        <header className="pk-head">
          <h2>{W.title}</h2>
          <p>{W.intro}</p>
        </header>
      ) : lede ? <p className="pk-lede">{W.intro}</p> : <p className="pk-lede ui-hint">{W.private}</p>}
      <div className="pk-grid">
        <section className="pk-checks" aria-labelledby={`${id}-checks`}>
          <div className="pk-top">
            <h3 id={`${id}-checks`}>{W.checksHead}</h3>
            <Verdict state={state} made={made} bad={bad.length} dashed={dashed} onRun={() => void check(current, 'first')} />
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
          </div>
          <ol className="pk-list">
            {CHECK_IDS.map((cid, i) => (
              <Row key={cid} rowId={`${id}-row-${cid}`} id={cid} line={state.lines[i] ?? null} current={running && made === i} first={i === firstBad} run={state.run} />
            ))}
          </ol>
          {state.refused ? <p className="pk-refused" role="alert">{state.refused}</p> : null}
          {notJson ? <p className="ui-hint">{W.notJson}</p> : null}
          {readError ? <p className="pk-refused" role="alert">{readError}</p> : null}
          <h3 className="pk-sub">{W.limitsHead}</h3>
          <ul className="pk-limits">{W.limits.map((t) => <li key={t}>{t}</li>)}</ul>
        </section>
        <aside className="pk-file" aria-label={W.fileHead}>
          <h3 id={`${id}-tamper`}>{W.tamperHead}</h3>
          <p className="ui-hint">{everChecked ? W.tamperIntro : W.tamperFirst}</p>
          <div className="pk-tampers" role="group" aria-labelledby={`${id}-tamper`}>
            {TAMPERS_SHOWN.map((tid) => {
              const e = editsFor(tid, original);
              const w = TAMPER_WORDS[tid];
              return (
                <button key={tid} type="button" className="pk-tamper" aria-pressed={tamper === tid} disabled={!e || running || !everChecked} onClick={() => applyTamper(tid)}>
                  <b>{w.label}</b>
                  <span>{e ? caption(tid, original, e) : w.what}</span>
                </button>
              );
            })}
          </div>
          <details className="pk-edit">
            <summary>{W.edit}</summary>
            <label htmlFor={`${id}-text`} className="pk-label">{W.editLabel}</label>
            <p className="ui-hint" id={`${id}-hint`}>{W.editHint}</p>
            <div className="pk-jumps" role="group" aria-label={W.jump}>
              {(Object.keys(W.jumpTo) as Place[]).map((p) => (
                <Btn key={p} sm kind="plain" disabled={!places[p]} onClick={() => jump(p)}>{`${W.jump} ${W.jumpTo[p]}`}</Btn>
              ))}
            </div>
            <textarea id={`${id}-text`} ref={editor} className="pk-text mono" spellCheck={false} wrap="off" rows={14} value={draft} aria-describedby={`${id}-hint`}
              onChange={(e) => setDraft(e.target.value)} />
            <Btn sm onClick={checkEdited} disabled={running}>{W.checkEdited}</Btn>
          </details>

          <h3 className="pk-sub" id={`${id}-file`}>{W.fileHead}</h3>
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
              {sample && !file.sample ? <Btn sm onClick={() => { setFile(sample); reset(); }}>{W.page.use}</Btn> : null}
              <input ref={input} type="file" accept=".tableproof,.json,application/json" className="sr-only" tabIndex={-1} aria-hidden="true"
                onChange={(e) => { const picked = e.target.files?.[0]; if (picked) void load(picked); e.target.value = ''; }} />
            </div>
            <p className="ui-hint">{W.dropHint}</p>
            {state.facts ? <FactsBlock facts={state.facts} own={own} /> : null}
          </div>
        </aside>
      </div>
      <div className="pk-drop" aria-hidden="true"><span>{W.dropNow}</span></div>
    </div>
  );
}

/** What a tamper does to this file, in numbers a person recognises. */
function caption(tid: TamperId, doc: unknown, edits: ReturnType<typeof editsFor> & object): string {
  const first = edits[0];
  if (!first) return '';
  const before = readAt(doc, first.path);
  const currency = String(readAt(doc, '/deal/terms/unit_price/currency') ?? 'USD');
  const money = (minor: unknown): string => (typeof minor === 'number' ? formatMoney({ minor, currency } as Parameters<typeof formatMoney>[0]) : '—');
  switch (tid) {
    case 'price':
    case 'receipt':
    case 'rules':
      return `${money(before)} → ${money(first.value)}`;
    case 'paypal-amount':
      return `${String(before)} → ${String(first.value)} ${currency}`;
    case 'payee':
      return `${String(before)} → ${String(first.value)}`;
    case 'audit-line':
      return 'one number, a deadline moved later';
    case 'audit-gap':
      return first.path.replace('/audit/', 'record ').replace(/^record (\d+)$/, (_m, n: string) => `one of the ${(readAt(doc, '/audit') as unknown[]).length} records, the ${Number(n) + 1}th, removed`);
    case 'signature':
      return 'message 3, its signature’s first character';
    case 'refund':
      return 'a call to refund the capture';
    case 'owner-key':
      return 'the buyer’s owner key in its place';
    default:
      return '';
  }
}
/** How many values a hand edit changed, with the first one. */
function changed(before: unknown, after: unknown): string {
  if (after === null) return W.editedByHand;
  const all = changes(before, after);
  const [first] = all;
  if (!first) return W.editedByHand;
  return all.length === 1 ? `${brief(first.before)} → ${brief(first.after)}` : `${all.length} values, by hand (the first: ${brief(first.before)} → ${brief(first.after)})`;
}

// ---- the verdict, the lines, what the file says -----------------------------------------------

function Verdict({ state, made, bad, dashed, onRun }: { state: RunState; made: number; bad: number; dashed: number; onRun: () => void }) {
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
      <Btn kind={done || running ? 'default' : 'primary'} disabled={running} onClick={onRun}>
        {running ? W.running : done ? W.rerun : W.run}
      </Btn>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{done ? `${word}. ${why}` : ''}</span>
    </div>
  );
}

function Row({ id, rowId, line, current, first, run }: { id: string; rowId: string; line: CheckLine | null; current: boolean; first: boolean; run: number }) {
  const kind = line ? kindOf(line) : null;
  const words = PROOF_CHECKS[id] ?? 'A check this page does not know.';
  const state = kind ?? (current ? 'now' : 'wait');
  const sr = kind === 'ok' ? W.sr.passed : kind === 'bad' ? W.sr.failed : kind === 'dashed' ? W.sr.unchecked : '';
  return (
    <li id={rowId} className={`pk-row ${state}${first ? ' first' : ''}`} key={`${id}-${run}`} data-check={id} aria-current={current ? 'step' : undefined}>
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

