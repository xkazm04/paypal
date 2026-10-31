// live.ts - the arena's live mode: a judge's own agent app playing through table-sandbox.
//
// WHY a separate module: the recorded cards are the arena's default and the film's. Live mode is an
// optional second source that exists only while `cargo run -p table-sandbox` runs on this machine.
// The arena renders whatever this module reports and never talks to the sandbox itself, so the
// recorded path cannot depend on a live server.
//
// The bridge (crates/table-sandbox/src/front.rs, README "The arena bridge"): every request carries
// `x-sandbox: arena`, and the sandbox answers only this page's origins (ports 1430). `useLive`
// probes `/api/arena/hello` with a 1 s timeout once on mount, then again only when the window gets the
// focus back or the arena's "Connect my agent app" asks (liveReach.ts askForLive), never on a timer while
// nothing answers: Chrome logs every refused probe as a console error, which no script can silence. While
// it answers, it polls `/api/journal` every 1.5 s, maps each tool call the agent made to a `LiveAnswer`,
// and probes every 10 s to notice the sandbox going away. Anything else (no sandbox, a timeout, a stranger
// on the port) reads as recorded. It never probes at all where live mode cannot apply: in the desktop app
// and under the director, its rehearsals and the film capture (liveReach.ts liveApplies).
// Nothing here can move money: the bridge has no such route.
import { useEffect, useState } from 'react';
import { LIVE_ASK_EVENT, liveApplies } from './liveReach';

export type LiveAnswer = { at: string; tool: string; verdict: 'yes' | 'no'; rule: string | null; sentence: string; paypalAsked: number };
export type LiveState =
  | { status: 'recorded' } // no sandbox: the 14 recorded cards
  | { status: 'live'; table: string | null; answers: LiveAnswer[] };

export const LIVE_PORT = 1443;

const BASE = `http://127.0.0.1:${LIVE_PORT}`;
const HEADER = { 'x-sandbox': 'arena' } as const;
const PROBE_TIMEOUT_MS = 1_000;
/** While live: how often the sandbox is asked whether it is still there. */
const PROBE_EVERY_MS = 10_000;
/** A focus and a visibility change arrive together: one probe for both. */
const FOCUS_GAP_MS = 2_000;
const JOURNAL_EVERY_MS = 1_500;
/** The most answers kept (the sandbox's own journal keeps 500 entries). */
const KEEP = 500;

const RECORDED: LiveState = { status: 'recorded' };

/** One journal entry as `crates/table-sandbox/src/journal.rs` serializes it (the fields read here). */
type JournalEntry = {
  seq: number;
  /** Unix milliseconds. */
  at: number;
  method: string;
  tool: string | null;
  outcome: 'answered' | 'refused' | 'protocol' | 'error';
  /** The wallet's closed refusal code, when refused. */
  code: string | null;
  /** Which rule answered, in plain words. */
  rule: string;
  /** Requests the buyer wallet's PayPal client had tried to send, after this call. */
  paypal: number;
};

/**
 * A tool call the wallet answered or refused, as the arena shows it: `rule` is the closed refusal
 * code (null when answered), `sentence` the sandbox's plain words for the rule that answered.
 * Protocol steps, turned-away requests, table markers and seller notes are not answers.
 */
function toAnswer(entry: JournalEntry): LiveAnswer | null {
  if (!entry.tool || (entry.outcome !== 'answered' && entry.outcome !== 'refused')) return null;
  const at = new Date(entry.at);
  return {
    at: Number.isNaN(at.getTime()) ? '' : at.toISOString(),
    tool: entry.tool,
    verdict: entry.outcome === 'answered' ? 'yes' : 'no',
    rule: entry.outcome === 'refused' ? (entry.code ?? null) : null,
    sentence: entry.rule,
    paypalAsked: entry.paypal,
  };
}

async function timed(path: string, init: RequestInit, ms: number): Promise<Response | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ms);
  try {
    return await fetch(BASE + path, { ...init, signal: abort.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The open table when the sandbox answers (`null`: it answers with no table open), else `undefined`. */
async function probe(): Promise<string | null | undefined> {
  const answer = await timed('/api/arena/hello', { headers: HEADER }, PROBE_TIMEOUT_MS);
  if (!answer || answer.status !== 200) return undefined;
  try {
    const hello: unknown = await answer.json();
    if (!hello || typeof hello !== 'object') return undefined;
    const h = hello as Record<string, unknown>;
    if (h.sandbox !== 'table-sandbox' || h.version !== 1) return undefined;
    return typeof h.table === 'string' ? h.table : null;
  } catch {
    return undefined;
  }
}

/** Journal entries after `seq`, or null when the read failed. */
async function journal(after: number): Promise<JournalEntry[] | null> {
  const answer = await timed(`/api/journal?after=${after}`, { headers: HEADER }, JOURNAL_EVERY_MS);
  if (!answer || answer.status !== 200) return null;
  try {
    const rows: unknown = await answer.json();
    return Array.isArray(rows) ? (rows as JournalEntry[]) : null;
  } catch {
    return null;
  }
}

export function useLive(): LiveState {
  const [state, setState] = useState<LiveState>(RECORDED);
  useEffect(() => {
    // Where live mode cannot apply, nothing is ever sent: the recorded cards it is.
    if (!liveApplies()) return undefined;
    let gone = false;
    let live = false;
    let probing = false;
    let lastProbe = 0;
    let probeTimer: ReturnType<typeof setInterval> | null = null;
    let table: string | null = null;
    let after = 0;
    let answers: LiveAnswer[] = [];
    let reading = false;
    let journalTimer: ReturnType<typeof setInterval> | null = null;

    const publish = () => {
      if (!gone) setState(live ? { status: 'live', table, answers } : RECORDED);
    };
    const read = async () => {
      if (reading || !live) return;
      reading = true;
      try {
        const rows = await journal(after);
        if (gone || !live || !rows || rows.length === 0) return;
        const fresh: LiveAnswer[] = [];
        for (const row of rows) {
          if (typeof row.seq === 'number' && row.seq > after) after = row.seq;
          const answer = toAnswer(row);
          if (answer) fresh.push(answer);
        }
        if (fresh.length > 0) {
          answers = [...answers, ...fresh].slice(-KEEP);
          publish();
        }
      } finally {
        reading = false;
      }
    };
    const check = async () => {
      if (probing) return;
      probing = true;
      lastProbe = Date.now();
      let found: string | null | undefined;
      try {
        found = await probe();
      } finally {
        probing = false;
      }
      if (gone) return;
      if (found === undefined) {
        // Gone (or never there): back to the recorded cards, and quiet until the window is focused
        // again or the person asks; start over when it returns.
        if (journalTimer) clearInterval(journalTimer);
        journalTimer = null;
        if (probeTimer) clearInterval(probeTimer);
        probeTimer = null;
        const was = live;
        live = false;
        after = 0;
        answers = [];
        table = null;
        if (was) publish();
        return;
      }
      const changed = !live || found !== table;
      live = true;
      table = found;
      if (!journalTimer) {
        journalTimer = setInterval(() => void read(), JOURNAL_EVERY_MS);
        void read();
      }
      // While it answers, keep asking whether it is still there (an answering port logs nothing).
      if (!probeTimer) probeTimer = setInterval(() => void check(), PROBE_EVERY_MS);
      if (changed) publish();
    };
    /** The window has the person's attention again: look once, unless live already or just looked. */
    const onFocus = () => {
      if (live || Date.now() - lastProbe < FOCUS_GAP_MS) return;
      void check();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') onFocus();
    };
    /** "Connect my agent app": look now. */
    const onAsk = () => void check();

    void check();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(LIVE_ASK_EVENT, onAsk);
    return () => {
      gone = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(LIVE_ASK_EVENT, onAsk);
      if (probeTimer) clearInterval(probeTimer);
      if (journalTimer) clearInterval(journalTimer);
    };
  }, []);
  return state;
}

/** Hands the sandbox's house seller `text` as its note on the open table; true when accepted. */
export async function sendLiveNote(text: string): Promise<boolean> {
  const answer = await timed(
    '/api/arena/note',
    { method: 'POST', headers: { ...HEADER, 'content-type': 'application/json' }, body: JSON.stringify({ text }) },
    5_000,
  );
  return answer?.status === 200;
}
