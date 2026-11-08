// The "You do this" card and the wait that follows it. The harness stops at every step only the owner
// may take, prints what to click, where, and what done looks like, then watches the app (DOM reads,
// or the ledger copy) until the step shows as done, or a timeout says so in plain words. While it
// waits the owner may type a line: "s" skips the step (with a reason), "n <text>" adds a note to the
// friction log, "d" says it is done when the harness cannot see it (recorded as owner-reported).
import { createInterface } from 'node:readline';

const W = 78;
const line = (ch = '─') => ch.repeat(W);
const wrap = (text, indent) => {
  const out = [];
  for (const para of String(text).split('\n')) {
    let cur = '';
    for (const word of para.split(/\s+/)) {
      if ((cur + ' ' + word).trim().length > W - indent - 2) {
        out.push(cur);
        cur = word;
      } else cur = `${cur} ${word}`.trim();
    }
    out.push(cur);
  }
  return out;
};

/** Print a card. `kind` is 'owner' (YOU DO THIS), 'simulated' (mock stands in), 'script', 'gap'. */
export function printCard(log, { kind, n, total, title, where, steps = [], done, note }) {
  const head = kind === 'owner' ? 'YOU DO THIS' : kind === 'simulated' ? 'SIMULATED OWNER STEP (mock world, no real money, no real keys)' : kind === 'gap' ? 'NOT SUPPORTED BY THE PRODUCT (recorded as a gap)' : 'THE SCRIPT DOES THIS';
  log('');
  log(`┌${line()}`);
  log(`│ ${head}`);
  log(`│ Beat ${n} of ${total}: ${title}`);
  log(`├${line()}`);
  if (where) for (const [i, l] of wrap(where, 8).entries()) log(`│ ${i ? '       ' : 'Where: '}${l}`);
  steps.forEach((s, i) => {
    for (const [j, l] of wrap(s, 6).entries()) log(`│ ${j ? '     ' : `${String(i + 1).padStart(2)}.  `}${l}`);
  });
  if (done) for (const [i, l] of wrap(done, 18).entries()) log(`│ ${i ? '                 ' : 'Done looks like: '}${l}`);
  if (note) for (const l of wrap(note, 2)) log(`│ ${l}`);
  if (kind === 'owner') {
    log(`│`);
    log(`│ The script now watches the app and carries on by itself when it sees this done.`);
    log(`│ It never presses anything in the approval window. Type + Enter at any time:`);
    log(`│   d = I did it (if the script cannot see it)   s <why> = skip this step`);
    log(`│   n <text> = add a note to the friction log`);
  }
  log(`└${line()}`);
}

/** Lines the owner types while the harness waits. One reader for the whole run. */
export class OwnerInput {
  constructor(enabled) {
    this.queue = [];
    this.enabled = enabled && process.stdin.isTTY;
    if (this.enabled) {
      this.rl = createInterface({ input: process.stdin });
      this.rl.on('line', (l) => this.queue.push(l.trim()));
    }
  }
  take() {
    return this.queue.shift() ?? null;
  }
  close() {
    this.rl?.close();
  }
}

/**
 * Poll `detect()` (returns a truthy signal description when the step is done) every `everyMs` until
 * done, skipped or `timeoutMs` passes. Owner lines are honoured between polls.
 */
export async function waitFor(detect, { timeoutMs, everyMs = 2000, input = null, log, label }) {
  const start = Date.now();
  const notes = [];
  let lastShown = 0;
  for (;;) {
    let signal = null;
    try {
      signal = await detect();
    } catch (e) {
      signal = null;
      if (Date.now() - lastShown > 30_000) log(`  (still watching; the last read failed: ${String(e.message ?? e).split('\n')[0]})`);
    }
    if (signal) return { status: 'done', signal: String(signal), ms: Date.now() - start, notes };
    for (let l = input?.take(); l != null; l = input?.take()) {
      if (l === 'd') return { status: 'owner-reported', signal: 'the owner said it is done; the script could not see it', ms: Date.now() - start, notes };
      if (l === 's' || l.startsWith('s ')) return { status: 'skipped', signal: l.slice(1).trim() || 'skipped by the owner', ms: Date.now() - start, notes };
      if (l.startsWith('n ')) {
        notes.push(l.slice(2));
        log('  noted.');
      }
    }
    const waited = Date.now() - start;
    if (waited > timeoutMs) return { status: 'timeout', signal: `not seen within ${Math.round(timeoutMs / 1000)} s`, ms: waited, notes };
    if (Date.now() - lastShown > 60_000) {
      lastShown = Date.now();
      if (waited > 1000) log(`  … still waiting for: ${label} (${Math.round(waited / 1000)} s of ${Math.round(timeoutMs / 1000)} s)`);
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
}
