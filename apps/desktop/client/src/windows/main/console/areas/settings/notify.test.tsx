// Settings · Notifications: a switch writes from a fresh read of the stored preferences. When that
// read fails nothing is written, and the owner is told so (as when the write itself fails) instead of
// a click that silently does nothing.
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_CARD, SETTINGS_NOTIFY } from '../../../../../lib/words';
import { renderLayerAtScale, settle } from '../../testing/scaleSmoke';

vi.mock('../../../../../lib/runtime', async () => (await import('../../testing/runtime')).runtimeMock);
const flag = vi.hoisted(() => ({ failSettings: false }));
vi.mock('../../../../../lib/data/invoke', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../../../lib/data/invoke')>();
  return {
    ...real,
    readCommand: ((cmd: string, ...rest: unknown[]) => (flag.failSettings && cmd === 'get_settings'
      ? Promise.reject({ code: 'UNAVAILABLE', message: 'Settings could not be read' })
      : (real.readCommand as (c: string, ...r: unknown[]) => Promise<unknown>)(cmd, ...rest))) as typeof real.readCommand,
  };
});

afterEach(() => { flag.failSettings = false; cleanup(); history.replaceState(null, '', '/'); });

describe('Settings · Notifications', () => {
  it('says the change was not made when the fresh read fails, and writes nothing', async () => {
    const r = await renderLayerAtScale({ level: 'place', place: 'settings' }, 'small');
    const card = [...r.layer.querySelectorAll<HTMLButtonElement>('button.pf-card')].find((b) => b.querySelector('.sc-label')?.textContent?.startsWith(SETTINGS_CARD.notify));
    fireEvent.click(card!);
    const dnd = await waitFor(() => within(r.layer).getByRole('switch', { name: SETTINGS_NOTIFY.dndLabel }));
    const before = r.calls.length;
    flag.failSettings = true;
    fireEvent.click(dnd);
    await settle();
    expect(r.calls.slice(before).filter((c) => c.cmd === 'settings_write')).toEqual([]);
    const view = r.layer.querySelector<HTMLElement>('.pf-view')!;
    await waitFor(() => expect(view.querySelector('.notice')?.textContent).toContain(SETTINGS_NOTIFY.failed));
    expect(within(r.layer).getByRole('switch', { name: SETTINGS_NOTIFY.dndLabel }).getAttribute('aria-checked')).toBe('false');
  }, 60_000);
});
