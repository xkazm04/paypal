// Pause or resume ONE agent (agent_pause / agent_resume) beside its row in Settings › Your agents:
// the right command with the agent's slot, busy, done (read back from the settings the wallet sends
// after it) and refused in the wallet's own words; each row's button has its own accessible name.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentSlot } from '@bindings/AgentSlot';
import { SETTINGS_AGENT_ONE, SETTINGS_CARD } from '../../../../../lib/words';
import { renderLayerAtScale, settle } from '../../testing/scaleSmoke';
import { setHarnessBackend } from '../../testing/runtime';
import type { Backend } from '../../../../../lib/contract';
import { AgentPause, isPausedAlone } from './AgentPause';

vi.mock('../../../../../lib/runtime', async () => (await import('../../testing/runtime')).runtimeMock);

type Call = { cmd: string; args: unknown };
function fake(answer: (cmd: string) => Promise<unknown>): Call[] {
  const calls: Call[] = [];
  setHarnessBackend({ kind: 'mock', label: 'main', invoke: (cmd: string, args: unknown) => { calls.push({ cmd, args }); return answer(cmd); }, listen: async () => () => {} } as unknown as Backend);
  return calls;
}

afterEach(() => { cleanup(); setHarnessBackend(null); history.replaceState(null, '', '/'); });

describe('AgentPause', () => {
  it('reads the paused state from the settings list', () => {
    expect(isPausedAlone('shopper', ['shopper'])).toBe(true);
    expect(isPausedAlone('negotiator', ['shopper'])).toBe(false);
    expect(isPausedAlone('negotiator', undefined)).toBe(false);
  });

  it('Pause calls agent_pause with the slot and says it is busy until the wallet answers', async () => {
    let answer!: (v: null) => void;
    const calls = fake(() => new Promise((r) => { answer = r; }));
    render(<ul className="st-list"><li><AgentPause slot="shopper" paused={false} known /></li></ul>);
    const btn = screen.getByRole('button', { name: SETTINGS_AGENT_ONE.pauseLabel('shopper') });
    fireEvent.click(btn);
    expect(calls).toEqual([{ cmd: 'agent_pause', args: { agent: 'shopper' } }]);
    await waitFor(() => expect(btn.textContent).toBe(SETTINGS_AGENT_ONE.pausing));
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { answer(null); });
    await waitFor(() => expect(btn.textContent).toBe(SETTINGS_AGENT_ONE.pause));
  });

  it('a paused agent shows "paused" and Resume calls agent_resume', () => {
    const calls = fake(async () => null);
    render(<AgentPause slot="negotiator" paused known />);
    expect(screen.getByText(SETTINGS_AGENT_ONE.paused)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: SETTINGS_AGENT_ONE.resumeLabel('negotiator') }));
    expect(calls).toEqual([{ cmd: 'agent_resume', args: { agent: 'negotiator' } }]);
  });

  it('a refusal stays on screen in the wallet’s words', async () => {
    fake(async () => { throw { code: 'INVALID', message: 'Invalid or stale wallet command' }; });
    render(<AgentPause slot="assistant" paused={false} known />);
    fireEvent.click(screen.getByRole('button', { name: SETTINGS_AGENT_ONE.pauseLabel('assistant') }));
    const notice = await screen.findByRole('alert');
    expect(notice.textContent).toContain(SETTINGS_AGENT_ONE.pauseFailed('Assistant'));
    expect(notice.textContent).toContain('Invalid or stale wallet command');
  });

  it('waits while the settings are unknown', () => {
    fake(async () => null);
    render(<AgentPause slot="shopper" paused={false} known={false} />);
    expect((screen.getByRole('button', { name: SETTINGS_AGENT_ONE.pauseLabel('shopper') }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('three agents: three buttons, three accessible names', () => {
    fake(async () => null);
    const slots: AgentSlot[] = ['negotiator', 'shopper', 'assistant'];
    render(<>{slots.map((s) => <AgentPause key={s} slot={s} paused={s === 'shopper'} known />)}</>);
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(new Set(names).size).toBe(3);
  });
});

describe('Settings › Your agents, on the preview wallet', () => {
  it('pausing one agent flips its row to paused from the settings the wallet sends, and resuming flips it back', async () => {
    const r = await renderLayerAtScale({ level: 'place', place: 'settings' }, null);
    const card = [...r.layer.querySelectorAll<HTMLButtonElement>('button.pf-card')].find((b) => b.querySelector('.sc-label')?.textContent?.startsWith(SETTINGS_CARD.agents));
    fireEvent.click(card!);
    const view = await waitFor(() => r.layer.querySelector<HTMLElement>('.pf-view .st-agents')!);
    const pause = await waitFor(() => within(view).getByRole('button', { name: SETTINGS_AGENT_ONE.pauseLabel('shopper') }));
    fireEvent.click(pause);
    await settle();
    expect(r.calls.filter((c) => c.cmd === 'agent_pause')).toEqual([{ cmd: 'agent_pause', args: { agent: 'shopper' } }]);
    const resume = await waitFor(() => within(r.layer.querySelector<HTMLElement>('.pf-view .st-agents')!).getByRole('button', { name: SETTINGS_AGENT_ONE.resumeLabel('shopper') }));
    // The other agents keep their own Pause.
    expect(within(r.layer).getByRole('button', { name: SETTINGS_AGENT_ONE.pauseLabel('negotiator') })).toBeTruthy();
    fireEvent.click(resume);
    await settle();
    expect(r.calls.filter((c) => c.cmd === 'agent_resume')).toEqual([{ cmd: 'agent_resume', args: { agent: 'shopper' } }]);
    await waitFor(() => within(r.layer).getByRole('button', { name: SETTINGS_AGENT_ONE.pauseLabel('shopper') }));
    // Neither starts anything.
    expect(r.calls.filter((c) => c.cmd === 'agent_start')).toEqual([]);
  }, 60_000);
});
