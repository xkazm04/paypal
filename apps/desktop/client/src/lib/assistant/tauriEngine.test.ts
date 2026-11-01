import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Backend, CommandName } from '../contract';
import { WalletError } from '../contract';
import { buildDigest } from './digest';
import { mayaWeek } from './fixtures';
import { systemPrompt } from './prompt';
import { createTauriEngine, QUESTION_MAX, TAURI_TIMEOUT_MS, assistantText, tauriAssistantAvailable } from './tauriEngine';
import { replyJsonSchema } from './vocabulary';

const reply = { v: 1, say: 'Two need you.', ops: [] };

function shell(invoke: (cmd: CommandName, args: unknown) => Promise<unknown>, kind: Backend['kind'] = 'tauri', label: Backend['label'] = 'main'): Backend {
  return {
    kind,
    label,
    invoke: vi.fn(invoke) as unknown as Backend['invoke'],
    listen: async () => () => undefined,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createTauriEngine', () => {
  it('sends one text, the question and the digest as the bridge writes them, and parses the reply', async () => {
    const b = shell(async () => JSON.stringify(reply));
    const input = mayaWeek();
    const out = await createTauriEngine(() => b).ask('What needs me?', input);
    expect(out).toEqual(reply);
    expect(b.invoke).toHaveBeenCalledTimes(1);
    expect(b.invoke).toHaveBeenCalledWith('assistant_ask', { text: `What needs me?\n\n${buildDigest(input)}\n` });
    expect(assistantText('q', input)).toBe(`q\n\n${buildDigest(input)}\n`);
  });

  it('carries nothing but the text: no prompt, no schema, no engine choice', async () => {
    const b = shell(async () => JSON.stringify(reply));
    await createTauriEngine(() => b).ask('q', mayaWeek());
    const args = (b.invoke as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[1];
    expect(Object.keys(args as object)).toEqual(['text']);
    expect(String((args as { text: string }).text)).not.toContain('Output rule');
  });

  it('reports itself as the claude-code engine', () => {
    expect(createTauriEngine(() => shell(async () => '')).info).toEqual({ id: 'claude-code', label: 'claude-code' });
  });

  it('maps every failure to a reason word', async () => {
    const cases: [unknown, string][] = [
      [new WalletError({ code: 'REFUSED', message: 'busy' }), 'busy'],
      [new WalletError({ code: 'INVALID', message: 'x' }), 'bad_request'],
      [new WalletError({ code: 'UNAVAILABLE', message: 'secret internal text' }), 'unavailable'],
      [new WalletError({ code: 'PERMISSION', message: 'x' }), 'unavailable'],
      ['transport', 'unavailable'],
    ];
    for (const [err, reason] of cases) {
      const b = shell(async () => { throw err; });
      await expect(createTauriEngine(() => b).ask('q', mayaWeek())).rejects.toThrow(new Error(reason));
    }
    for (const bad of ['not json', 42, null]) {
      const b = shell(async () => bad);
      await expect(createTauriEngine(() => b).ask('q', mayaWeek())).rejects.toThrow(new Error('bad_output'));
    }
  });

  it('never asks the mock, another window or with a bad question', async () => {
    for (const b of [shell(async () => '{}', 'mock'), shell(async () => '{}', 'tauri', 'approval'), shell(async () => '{}', 'tauri', 'tumbler')]) {
      await expect(createTauriEngine(() => b).ask('q', mayaWeek())).rejects.toThrow(new Error('unavailable'));
      expect(b.invoke).not.toHaveBeenCalled();
    }
    const b = shell(async () => '{}');
    await expect(createTauriEngine(() => b).ask('  ', mayaWeek())).rejects.toThrow(new Error('bad_request'));
    await expect(createTauriEngine(() => b).ask('x'.repeat(QUESTION_MAX + 1), mayaWeek())).rejects.toThrow(new Error('bad_request'));
    expect(b.invoke).not.toHaveBeenCalled();
  });

  it('stops waiting on abort and on its own deadline', async () => {
    const pending = shell(() => new Promise(() => undefined));
    const ctl = new AbortController();
    const asked = createTauriEngine(() => pending).ask('q', mayaWeek(), ctl.signal);
    ctl.abort();
    await expect(asked).rejects.toThrow(new Error('aborted'));
    const already = new AbortController();
    already.abort();
    await expect(createTauriEngine(() => pending).ask('q', mayaWeek(), already.signal)).rejects.toThrow(new Error('aborted'));

    vi.useFakeTimers();
    const late = createTauriEngine(() => pending).ask('q', mayaWeek());
    const settled = expect(late).rejects.toThrow(new Error('timeout'));
    await vi.advanceTimersByTimeAsync(TAURI_TIMEOUT_MS + 1);
    await settled;
  });
});

describe('tauriAssistantAvailable', () => {
  it('asks the shell for its status, main window only, and never throws', async () => {
    const yes = shell(async () => ({ available: true, reason: null }));
    expect(await tauriAssistantAvailable(() => yes)).toBe(true);
    expect(yes.invoke).toHaveBeenCalledWith('assistant_status', null);
    expect(await tauriAssistantAvailable(() => shell(async () => ({ available: false, reason: 'no' })))).toBe(false);
    expect(await tauriAssistantAvailable(() => shell(async () => { throw new WalletError({ code: 'UNAVAILABLE', message: 'x' }); }))).toBe(false);
    expect(await tauriAssistantAvailable(() => shell(async () => ({ available: true }), 'mock'))).toBe(false);
    expect(await tauriAssistantAvailable(() => shell(async () => ({ available: true }), 'tauri', 'approval'))).toBe(false);
    expect(await tauriAssistantAvailable(() => { throw new Error('backend not initialised'); })).toBe(false);
  });
});

// The shell answers with a pinned copy of the system prompt and reply schema: the client's own
// prompt.ts and vocabulary.ts, written to a file Rust embeds. A change to either fails here until
// the copy is regenerated: UPDATE_ASSISTANT_CONTRACT=1 pnpm test tauriEngine (then rebuild Rust).
describe('the shell pins the prompt and schema this client speaks', () => {
  const file = join(__dirname, '../../../../../../crates/table-client/src/assistant_contract.json');
  const current = `${JSON.stringify({ system_prompt: systemPrompt(), schema: replyJsonSchema() }, null, 2)}\n`;
  it('assistant_contract.json equals prompt.ts and vocabulary.ts', () => {
    if (process.env.UPDATE_ASSISTANT_CONTRACT === '1') writeFileSync(file, current);
    expect(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), 'run UPDATE_ASSISTANT_CONTRACT=1 pnpm test tauriEngine').toBe(current);
  });
});
