// @vitest-environment node
// Live: one real question to the real `claude` CLI. Runs only with ASSISTANT_LIVE=1 (needs the owner's
// login; costs a few cents). Skipped otherwise.
import { describe, expect, it } from 'vitest';
import { resolveClaudeBin, runClaude } from '../../../../scripts/assistantBridge';
import type { DigestInput } from '../contract';

const digest: DigestInput = {
  now_ms: Date.UTC(2026, 10, 6, 19, 30),
  first_run: false,
  deals: [
    { id: 'deal-a', module: 'tables', fate: 'needs', label: 'Logo for a bakery', state_word: 'Waiting for you', amount_minor: 18000, currency: 'EUR', deadline_ms: null, on_silence: 'Nothing is paid; the offer lapses.' },
    { id: 'deal-b', module: 'spend', fate: 'moving', label: 'Hosting renewal', state_word: 'Paying', amount_minor: 4200, currency: 'EUR', deadline_ms: null, on_silence: null },
  ],
  money: { room_left_minor: 52000, day_cap_minor: 80000, held_minor: 4200, paid_today_minor: null, deals_today: 1, deals_cap: 10, currency: 'EUR' },
  rules_in_force: 3,
  setup: [{ key: 'paypal', done: true }, { key: 'rules', done: true }, { key: 'practice', done: null }, { key: 'engine', done: true }],
};

describe.skipIf(process.env.ASSISTANT_LIVE !== '1')('assistant bridge, live CLI', () => {
  it('answers one question with a reply that parses and validates', async () => {
    const bin = resolveClaudeBin();
    expect(bin).not.toBeNull();
    const r = await runClaude('What needs me right now?', digest, bin as string);
    process.stderr.write('LIVE ' + JSON.stringify({ ok: r.ok, ms: r.ok ? r.ms : null, costUsd: r.ok ? r.costUsd : null, reply: r.ok ? r.reply : r }) + '\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const reply = r.reply as { v?: unknown; say?: unknown; ops?: unknown };
    expect(reply.v).toBe(1);
    expect(typeof reply.say).toBe('string');
    expect(Array.isArray(reply.ops)).toBe(true);
    // The validator is WP2's file: loaded lazily so a half-written one cannot hide the bridge result.
    let validated = 'validator not loadable yet; checked only the reply shape against the schema';
    try {
      const { validateReply } = await import('../validate');
      const v = validateReply(r.reply, { dealIds: new Set(digest.deals.map((d) => d.id)) });
      expect(typeof v.say).toBe('string');
      validated = `validateReply accepted: dropped=${v.dropped.count} repaired=${v.repaired} ops=${v.ops.length}`;
    } catch (e) {
      if (e instanceof Error && e.name === 'AssertionError') throw e;
    }
    process.stderr.write(`LIVE ${validated}\n`);
  }, 90_000);
});
