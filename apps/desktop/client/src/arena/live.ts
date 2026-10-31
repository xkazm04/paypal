// live.ts - the arena's live mode: a judge's own agent app playing through table-sandbox.
//
// WHY a separate module: the recorded cards are the arena's default and the film's. Live mode is an
// optional second source that exists only while `cargo run -p table-sandbox` runs on this machine.
// The arena renders whatever this module reports and never talks to the sandbox itself, so the
// recorded path cannot depend on a live server.
//
// The bridge (crates/table-sandbox/src/front.rs, README "The arena bridge"): every request carries
// `x-sandbox: arena`, and the sandbox answers only this page's origins (ports 1430). `useLive`
// probes `/api/arena/hello` with a 1 s timeout on mount and every 10 s; while it answers, it
// polls `/api/journal` every 1.5 s and maps each tool call the agent made to a `LiveAnswer`.
// Anything else (no sandbox, a timeout, a stranger on the port) reads as recorded, silently.
// Nothing here can move money: the bridge has no such route.
import { useEffect, useState } from 'react';

export type LiveAnswer = { at: string; tool: string; verdict: 'yes' | 'no'; rule: string | null; sentence: string; paypalAsked: number };
export type LiveState =
  | { status: 'recorded' } // no sandbox: the 14 recorded cards
  | { status: 'live'; table: string | null; answers: LiveAnswer[] };

export const LIVE_PORT = 1443;

const BASE = `http://127.0.0.1:${LIVE_PORT}`;
const HEADER = { 'x-sandbox': 'arena' } as const;
const PROBE_TIMEOUT_MS = 1_000;
const PROBE_EVERY_MS = 10_000;
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
    let gone = false;
    let live = false;
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
      const found = await probe();
      if (gone) return;
      if (found === undefined) {
        // Gone (or never there): back to the recorded cards, and start over when it returns.
        if (journalTimer) clearInterval(journalTimer);
        journalTimer = null;
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
      if (changed) publish();
    };

    void check();
    const probeTimer = setInterval(() => void check(), PROBE_EVERY_MS);
    return () => {
      gone = true;
      clearInterval(probeTimer);
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
