// Engine selection: the desktop shell's claude-code when the shell says it would try, the dev bridge
// in a browser, the scripted preview otherwise; and every in-app reply still goes through validateReply.
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Backend, CommandName } from '../../../lib/contract';
import { WalletError } from '../../../lib/contract';
import { mayaWeek } from '../../../lib/assistant/fixtures';
import { useBoardAssistant } from './useBoardAssistant';

function shell(answers: Partial<Record<CommandName, (args: unknown) => Promise<unknown>>>, kind: Backend['kind'] = 'tauri'): Backend {
  return {
    kind,
    label: 'main',
    invoke: vi.fn(async (cmd: CommandName, args: unknown) => {
      const a = answers[cmd];
      if (!a) throw new WalletError({ code: 'PERMISSION', message: `not in this test: ${cmd}` });
      return a(args);
    }) as unknown as Backend['invoke'],
    listen: async () => () => undefined,
  };
}
const calls = (b: Backend): string[] => (b.invoke as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useBoardAssistant engine choice', () => {
  it('uses the shell when assistant_status says available, and validates its reply', async () => {
    const hostile = { v: 1, say: 'Two need you.', ops: [{ op: 'show', panel: { kind: 'needs', module: null } }, { op: 'pay', amount: 1 }] };
    const b = shell({
      assistant_status: async () => ({ available: true, reason: null }),
      assistant_ask: async () => JSON.stringify(hostile),
    });
    const { result } = renderHook(() => useBoardAssistant(undefined, { backend: () => b }));
    await waitFor(() => expect(result.current.engine.id).toBe('claude-code'));
    let outcome: Awaited<ReturnType<typeof result.current.ask>> | undefined;
    await act(async () => { outcome = await result.current.ask('What needs me?', mayaWeek()); });
    expect(outcome?.kind).toBe('reply');
    if (outcome?.kind !== 'reply') return;
    expect(outcome.engine.id).toBe('claude-code');
    expect(outcome.fellBack).toBe(false);
    expect(outcome.reply.say).toBe('Two need you.');
    expect(outcome.reply.ops).toEqual([{ op: 'show', panel: { kind: 'needs', module: null } }]);
    expect(outcome.reply.dropped.count).toBe(1);
    expect(calls(b)).toEqual(['assistant_status', 'assistant_ask']);
  });

  it('stays scripted when the shell says not available, and never asks', async () => {
    const b = shell({ assistant_status: async () => ({ available: false, reason: 'no' }) });
    const { result } = renderHook(() => useBoardAssistant(undefined, { backend: () => b }));
    await waitFor(() => expect(calls(b)).toEqual(['assistant_status']));
    expect(result.current.engine.id).toBe('scripted');
    await act(async () => { await result.current.ask('What needs me?', mayaWeek()); });
    expect(calls(b)).toEqual(['assistant_status']);
  });

  it('answers from the scripted engine, and says so, when the shell refuses a question', async () => {
    const b = shell({
      assistant_status: async () => ({ available: true, reason: null }),
      assistant_ask: async () => { throw new WalletError({ code: 'REFUSED', message: 'busy' }); },
    });
    const { result } = renderHook(() => useBoardAssistant(undefined, { backend: () => b }));
    await waitFor(() => expect(result.current.engine.id).toBe('claude-code'));
    let outcome: Awaited<ReturnType<typeof result.current.ask>> | undefined;
    await act(async () => { outcome = await result.current.ask('What needs me?', mayaWeek()); });
    expect(outcome?.kind === 'reply' && outcome.fellBack).toBe(true);
    expect(outcome?.kind === 'reply' && outcome.engine.id).toBe('scripted');
  });

  it('in the browser preview (the mock backend) asks the dev bridge, never the shell commands', async () => {
    const b = shell({}, 'mock');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: false, reason: 'unavailable' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useBoardAssistant(undefined, { backend: () => b }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(result.current.engine.id).toBe('scripted');
    expect(calls(b)).toEqual([]);
  });

  it('an injected probe keeps the old dev-bridge path and skips the shell', async () => {
    const b = shell({ assistant_status: async () => ({ available: true, reason: null }) });
    const probe = vi.fn(async () => false);
    const { result } = renderHook(() => useBoardAssistant(undefined, { backend: () => b, probe }));
    await waitFor(() => expect(probe).toHaveBeenCalledTimes(1));
    expect(result.current.engine.id).toBe('scripted');
    expect(calls(b)).toEqual([]);
  });
});
