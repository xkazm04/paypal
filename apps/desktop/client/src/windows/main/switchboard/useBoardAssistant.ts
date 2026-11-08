// The board's door to the assistant. One question goes: digest from the board model -> engine.ask ->
// validateReply -> a ValidatedReply the board applies. The engine is the injected one; else, in the
// desktop app (the real shell, not demo mode), the shell's `claude-code` (`assistant_ask`) when
// `assistant_status` says it would try; else, in the browser dev server, the dev bridge's
// `claude-code` when it answers a probe; else the scripted preview. The choice is made once, on mount.
// If the chosen engine fails for any reason, that question is answered by the scripted engine and the
// outcome says so (the board shows one line). A reply is a proposal: nothing here executes anything.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Backend } from '../../../lib/contract';
import { backend as pageBackend } from '../../../lib/runtime';
import {
  bridgeAvailable, createBridgeEngine, createScriptedEngine, createTauriEngine, tauriAssistantAvailable, validateReply,
  type AssistantEngine, type DigestInput, type EngineInfo, type ValidatedReply,
} from '../../../lib/assistant';

export type AssistantDeps = {
  /** The scripted engine used as the fallback (default: the real one). */
  scripted?: AssistantEngine;
  /** The validation door (default: the real one). */
  validate?: typeof validateReply;
  /** Probe for the dev bridge (default: bridgeAvailable). Skipped when an engine is injected; when
   *  given, the desktop shell is not asked. */
  probe?: () => Promise<boolean>;
  /** The page's backend (default: lib/runtime's; null when none is initialised). */
  backend?: () => Backend | null;
};

const currentBackend = (): Backend | null => {
  try {
    return pageBackend();
  } catch {
    return null;
  }
};

/** The live engine for this page, or null: the shell's in the desktop app, else the dev bridge's. */
async function chooseLive(deps: AssistantDeps): Promise<AssistantEngine | null> {
  const shell = deps.probe ? null : (deps.backend ?? currentBackend)();
  if (shell?.kind === 'tauri') {
    return (await tauriAssistantAvailable(() => shell)) ? createTauriEngine(() => shell) : null;
  }
  return (await (deps.probe ?? bridgeAvailable)()) ? createBridgeEngine() : null;
}

export type AskOutcome =
  | { kind: 'reply'; reply: ValidatedReply; engine: EngineInfo; fellBack: boolean }
  | { kind: 'cancelled' };

export type BoardAssistant = {
  /** The engine the next question goes to. */
  engine: EngineInfo;
  busy: boolean;
  /** While a question is in flight: the engine answering it, and whether it is the scripted fallback
   *  after the live engine failed (the board narrates exactly this while it waits). Null when idle. */
  answering: { engine: EngineInfo; fellBack: boolean } | null;
  ask: (question: string, input: DigestInput) => Promise<AskOutcome>;
  cancel: () => void;
};

export function useBoardAssistant(injected?: AssistantEngine, deps: AssistantDeps = {}): BoardAssistant {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const scripted = useRef<AssistantEngine | null>(null);
  const getScripted = (): AssistantEngine => (scripted.current ??= depsRef.current.scripted ?? createScriptedEngine());
  const [live, setLive] = useState<AssistantEngine | null>(null);
  const [busy, setBusy] = useState(false);
  const [answering, setAnswering] = useState<BoardAssistant['answering']>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (injected) return;
    let dead = false;
    void chooseLive(depsRef.current).then((e) => { if (!dead && e) setLive(e); }, () => undefined);
    return () => { dead = true; };
  }, [injected]);

  useEffect(() => () => abort.current?.abort(), []);

  const engine = injected ?? live ?? getScripted();

  const ask = useCallback(async (question: string, input: DigestInput): Promise<AskOutcome> => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(true);
    const known = { dealIds: new Set(input.deals.map((d) => d.id)) };
    const validate = depsRef.current.validate ?? validateReply;
    try {
      let used: AssistantEngine = injected ?? live ?? getScripted();
      let fellBack = false;
      let raw: unknown;
      setAnswering({ engine: used.info, fellBack: false });
      try {
        raw = await used.ask(question, input, ctl.signal);
      } catch (e) {
        if (ctl.signal.aborted) return { kind: 'cancelled' };
        if (used.info.id === 'scripted') throw e;
        used = getScripted();
        fellBack = true;
        if (abort.current === ctl) setAnswering({ engine: used.info, fellBack: true });
        raw = await used.ask(question, input, ctl.signal);
      }
      if (ctl.signal.aborted) return { kind: 'cancelled' };
      return { kind: 'reply', reply: validate(raw, known), engine: used.info, fellBack };
    } catch (e) {
      if (ctl.signal.aborted) return { kind: 'cancelled' };
      // The scripted engine itself failed: an empty, validated reply, so the board says it had nothing.
      return { kind: 'reply', reply: { say: '', ops: [], dropped: { count: 0, reasons: [] }, repaired: false }, engine: getScripted().info, fellBack: true };
    } finally {
      if (abort.current === ctl) { abort.current = null; setBusy(false); setAnswering(null); }
    }
  }, [injected, live]);

  const cancel = useCallback(() => { abort.current?.abort(); }, []);

  return { engine: engine.info, busy, answering, ask, cancel };
}
