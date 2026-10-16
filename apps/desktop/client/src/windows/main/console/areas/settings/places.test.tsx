// WP3c's layers at scale (console/testing/scaleSmoke.tsx): the deal page, the Rewind, Agent rules,
// the wallet limits, Connections, Connect a wallet, Settings and the safety record each draw their
// heading on the small shop and on the busy merchant with no console error, no raw enum name or id
// on screen, bounded list rows, inside the read budget, and send nothing but reads. Then the
// behaviour each owns: Settings' notices and pause key, Connections' list, Rules' names (#15).
import { act, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Route } from '../../../logic';
import { CONNECTIONS_PEOPLE, PLACE_FRAME, SETTINGS_AGENTS, SETTINGS_CARD, SETTINGS_NOTIFY } from '../../../../../lib/words';
import { expectLayerHealthy, renderLayerAtScale, settle, type Scale } from '../../testing/scaleSmoke';

vi.mock('../../../../../lib/runtime', async () => (await import('../../testing/runtime')).runtimeMock);

afterEach(() => { cleanup(); history.replaceState(null, '', '/'); });

const ROUTES: Array<[string, Route]> = [
  ['rewind', { level: 'rewind' }],
  ['rules', { level: 'place', place: 'rules' }],
  ['limits', { level: 'place', place: 'limits' }],
  ['connections', { level: 'place', place: 'connections' }],
  ['pairing', { level: 'place', place: 'pairing' }],
  ['settings', { level: 'place', place: 'settings' }],
  ['safety', { level: 'place', place: 'safety' }],
];
const SCALES: Scale[] = ['small', 'large'];

describe('WP3c layers at both scales', () => {
  for (const scale of SCALES) {
    it.each(ROUTES)(`%s (${scale})`, async (id, route) => {
      const r = await renderLayerAtScale(route, scale);
      expect(r.layer.dataset.layer).toBe(id);
      expectLayerHealthy(r);
    }, 60_000);
    it(`a deal (${scale})`, async () => {
      const r = await renderLayerAtScale(async (w) => ({ level: 'deal', deal: (await w.invoke('list_deals', null))[0]?.id ?? 'none' }), scale);
      expect(r.layer.dataset.layer).toBe('deal');
      expectLayerHealthy(r);
    }, 60_000);
  }
});

const card = (layer: HTMLElement, label: string) => {
  const c = [...layer.querySelectorAll<HTMLButtonElement>('button.pf-card')].find((b) => b.querySelector('.sc-label')?.textContent?.startsWith(label));
  if (!c) throw new Error(`no card ${label}`);
  return c;
};

describe('Settings', () => {
  it('a card opens its view on the same sheet, Escape closes it and gives focus back to the card', async () => {
    const r = await renderLayerAtScale({ level: 'place', place: 'settings' }, 'small');
    const c = card(r.layer, SETTINGS_CARD.agents);
    fireEvent.click(c);
    const view = await waitFor(() => { const v = r.layer.querySelector<HTMLElement>('.pf-view'); if (!v) throw new Error('no view'); return v; });
    expect(c.getAttribute('aria-expanded')).toBe('true');
    expect(c.textContent).toContain(PLACE_FRAME.close);
    await waitFor(() => expect(document.activeElement?.hasAttribute('data-view-title')).toBe(true));
    fireEvent.keyDown(document.activeElement ?? view, { key: 'Escape' });
    await waitFor(() => expect(r.layer.querySelector('.pf-view')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(card(r.layer, SETTINGS_CARD.agents)));
    // still on Settings: the Escape that closed the view did not go a layer up
    expect(document.querySelector('.cs-layer')?.getAttribute('data-layer')).toBe('settings');
  }, 60_000);

  it('a notices switch writes the stored preferences from a fresh read, changing that one field only', async () => {
    const r = await renderLayerAtScale({ level: 'place', place: 'settings' }, 'small');
    fireEvent.click(card(r.layer, SETTINGS_CARD.notify));
    const dnd = await waitFor(() => within(r.layer).getByRole('switch', { name: SETTINGS_NOTIFY.dndLabel }));
    expect(dnd.getAttribute('aria-checked')).toBe('false');
    const before = r.calls.length;
    fireEvent.click(dnd);
    await settle();
    const sent = r.calls.slice(before);
    const write = sent.find((c) => c.cmd === 'settings_write');
    expect(write).toBeTruthy();
    // the fresh read came first
    expect(sent.findIndex((c) => c.cmd === 'get_settings')).toBeLessThan(sent.findIndex((c) => c.cmd === 'settings_write'));
    expect(write?.args).toMatchObject({ dnd: true, notifications: true, form: 'rest', pinned: true });
    await waitFor(() => expect(within(r.layer).getByRole('switch', { name: SETTINGS_NOTIFY.dndLabel }).getAttribute('aria-checked')).toBe('true'));
    expect(sent.filter((c) => c.cmd !== 'get_settings' && c.cmd !== 'settings_write' && !/^(list_deals|attention_list|deal_display|agent_runs|counterparty_list|engine_status|mandate_list|owner_facts)$/.test(c.cmd))).toEqual([]);
  }, 60_000);

  it('P pauses every agent (one key, no confirmation); it never resumes them', async () => {
    const r = await renderLayerAtScale({ level: 'place', place: 'settings' }, 'small');
    (document.activeElement as HTMLElement | null)?.blur();
    await act(async () => { fireEvent.keyDown(window, { key: 'p' }); });
    await settle();
    expect(r.calls.filter((c) => c.cmd === 'pause_all_agents')).toHaveLength(1);
    await waitFor(() => expect(card(r.layer, SETTINGS_CARD.agents).textContent).toContain(SETTINGS_AGENTS.paused));
    await act(async () => { fireEvent.keyDown(window, { key: 'p' }); });
    await settle();
    expect(r.calls.filter((c) => c.cmd === 'resume_all_agents')).toHaveLength(0);
  }, 60_000);
});

describe('Connections', () => {
  it('lists who you deal with as a windowed, searchable list on the busy merchant', async () => {
    const r = await renderLayerAtScale({ level: 'place', place: 'connections' }, 'large');
    const list = within(r.layer).getByRole('region', { name: CONNECTIONS_PEOPLE.list });
    // 195 wallets: the count reads 99+, and only a window of rows is in the DOM
    expect(within(list).getByRole('button', { name: /^All/ }).textContent).toContain('99+');
    expect(list.querySelectorAll('.le-item').length).toBeLessThan(60);
    fireEvent.change(within(list).getByRole('searchbox'), { target: { value: 'house' } });
    await waitFor(() => expect(list.querySelectorAll('.le-item').length).toBeLessThan(10), { timeout: 3000 });
  }, 60_000);
});
