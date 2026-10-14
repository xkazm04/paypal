// A layer that throws (rebuild WP4a resilience pass): the window keeps its chrome, the layer shows
// its calm fallback (no error text, no blank sheet), and Back still walks the chain. The failure
// previews (?degrade=1, ?records=broken, ?forecast=off, ?groups=none, ?limits=none) are swept in the
// browser on every layer (docs/build/rebuild/wp4a.md).
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderLayerAtScale } from './testing/scaleSmoke';

vi.mock('../../../lib/runtime', async () => (await import('./testing/runtime')).runtimeMock);
vi.mock('./areas/safety/SafetyLayer', () => ({
  SafetyLayer: () => { throw new Error('the safety layer broke'); },
}));

afterEach(() => { cleanup(); history.replaceState(null, '', '/'); });

describe('a layer that throws', () => {
  it('shows its calm fallback under the chrome, and Back returns to the layer it came from', async () => {
    const r = await renderLayerAtScale({ level: 'place', place: 'settings' }, 'small');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const toSafety = document.querySelector<HTMLElement>('.cs-layer [data-fk="st-safety"]');
    if (!toSafety) throw new Error('no way to the safety record');
    await act(async () => { fireEvent.click(toSafety); });
    const fallback = await waitFor(() => { const el = document.querySelector('.cs-layer .boundary'); if (!el) throw new Error('no fallback'); return el; });
    expect(fallback.getAttribute('role')).toBe('alert');
    expect(document.body.textContent).not.toContain('the safety layer broke');
    // the chrome is whole: the tabs, the top bar, the crumbs
    expect(document.querySelector('[role="tablist"]')).toBeTruthy();
    expect(document.querySelector('.cs-bar .ui-crumbs')?.textContent).toContain('Settings');
    const back = document.querySelector<HTMLButtonElement>('.cs-back');
    if (!back) throw new Error('no Back');
    await act(async () => { fireEvent.click(back); });
    await waitFor(() => expect(document.querySelector('.cs-layer')?.getAttribute('data-layer')).toBe('settings'));
    expect(document.querySelector('.cs-layer .boundary')).toBeNull();
    spy.mockRestore();
    expect(r.calls.some((c) => c.cmd === 'approval_open')).toBe(false);
  }, 60_000);
});
