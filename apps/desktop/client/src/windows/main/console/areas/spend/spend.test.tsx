// The Spend layer on the mock worlds (rebuild WP3a): the summary and every nested view render on both
// worlds within the smoke checks; the proof is read only for the purchase that is open (never per
// row: scale finding #17's budget for this area); paying and releasing a hold hand off with
// `approval_open` only; the rule check picks a rule and filters; and the words keep the rules.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SPEND, SPEND_VIEWS } from '../../../../../lib/words';
import { expectLayerHealthy, renderLayerAtScale, type LayerRun } from '../../testing/scaleSmoke';
import { wordsOf } from '../tables/wordsOf';

vi.mock('../../../../../lib/runtime', async () => (await import('../../testing/runtime')).runtimeMock);

afterEach(() => { cleanup(); history.replaceState(null, '', '/'); });

const reads = (r: LayerRun, cmd: string) => r.calls.filter((c) => c.cmd === cmd).length;

describe('Spend at scale', () => {
  it.each(['small', 'large'] as const)('summary on the %s world', async (scale) => {
    const r = await renderLayerAtScale({ level: 'module', module: 'spend' }, scale);
    expect(r.layer.dataset.layer).toBe('spend');
    expectLayerHealthy(r);
    expect(r.layer.querySelectorAll('.ml-cards .ui-sumcard').length).toBe(4);
    // A purchase waits in both worlds: the chip and the card say what silence does.
    expect(r.layer.querySelector('[data-fk="your-call"]')).toBeTruthy();
    expect(r.layer.querySelector('.ui-sumcard.needs')?.textContent).toMatch(/If you do nothing/);
    expect(reads(r, 'deal_evidence')).toBe(0);
  }, 60_000);

  it.each(['need', 'week', 'gate', 'rules'] as const)('the %s view on the busy world', async (view) => {
    const r = await renderLayerAtScale({ level: 'module', module: 'spend', view }, 'large');
    expectLayerHealthy(r);
    expect(r.layer.querySelector('h1')?.textContent).toBe(SPEND_VIEWS[view]);
    // Visible-only proof reads: the one open purchase, plus a trailing refresh at most.
    expect(reads(r, 'deal_evidence')).toBeLessThanOrEqual(2);
  }, 60_000);
});

describe('Spend flows', () => {
  it('paying and releasing a hold open the approval window, nothing else', async () => {
    const r = await renderLayerAtScale({ level: 'module', module: 'spend', view: 'need' }, 'small');
    const pane = r.layer.querySelector<HTMLElement>('.tr-pane') as HTMLElement;
    expect(pane.textContent).toMatch(/If you do nothing/);
    const pay = within(pane).getAllByRole('button').find((b) => b.classList.contains('gold'));
    expect(pay?.textContent).toContain(SPEND.reviewPay);
    fireEvent.click(pay as HTMLElement);
    await waitFor(() => expect(r.calls.filter((c) => c.cmd === 'approval_open')).toHaveLength(1));
    const release = within(pane).getAllByRole('button').find((b) => b.textContent?.startsWith(SPEND.release));
    act(() => { release?.click(); });
    const confirm = await screen.findByRole('button', { name: new RegExp(SPEND.releaseIn) });
    fireEvent.click(confirm);
    await waitFor(() => expect(r.calls.filter((c) => c.cmd === 'approval_open')).toHaveLength(2));
    for (const c of r.calls.filter((x) => x.cmd === 'approval_open')) expect(Object.keys(c.args as object)).toEqual(['deal_id']);
    expect(r.calls.filter((c) => /capture|void|countersign|release/.test(c.cmd))).toEqual([]);
  }, 60_000);

  it('the rule check: a rule shows every purchase at it; the refused filter narrows the list', async () => {
    const r = await renderLayerAtScale({ level: 'module', module: 'spend', view: 'gate' }, 'large');
    const col = r.layer.querySelector<HTMLButtonElement>('.sp-col');
    act(() => { col?.click(); });
    await waitFor(() => expect(r.layer.querySelector('.tr-pane')?.textContent).toContain(SPEND.thisRule));
    const refused = [...r.layer.querySelectorAll<HTMLButtonElement>('.ui-filter')].find((b) => b.textContent?.startsWith(SPEND.fRefused));
    act(() => { refused?.click(); });
    await waitFor(() => expect(r.layer.querySelector('.le-summary')?.textContent).toMatch(/^Showing/));
  }, 60_000);

  it('the rule check never draws an unknown mark in a pass or fail colour (UX guide: nothing unknown looks green)', async () => {
    const r = await renderLayerAtScale({ level: 'module', module: 'spend', view: 'gate' }, 'large');
    const marks = [...r.layer.querySelectorAll<HTMLElement>('.sp-marks i')];
    const unknown = marks.filter((i) => i.textContent === '?');
    expect(unknown.length, 'the large world has purchases under other rule sets').toBeGreaterThan(0);
    expect(unknown.filter((i) => !i.classList.contains('unknown')).map((i) => i.className)).toEqual([]);
  }, 60_000);

  it('recent purchases are windowed and filter by outcome', async () => {
    const r = await renderLayerAtScale({ level: 'module', module: 'spend', view: 'week' }, 'large');
    expect(r.rows()).toBeLessThan(120);
    const paid = [...r.layer.querySelectorAll<HTMLButtonElement>('.ui-filter')].find((b) => b.textContent?.startsWith(SPEND.fPaid));
    act(() => { paid?.click(); });
    await waitFor(() => expect(paid?.getAttribute('aria-pressed')).toBe('true'));
  }, 60_000);
});

describe('Spend words', () => {
  it('never name a vendor other than PayPal, an engine, a raw state or an id', () => {
    for (const w of [...wordsOf(SPEND), ...wordsOf(SPEND_VIEWS)]) {
      expect(w).not.toMatch(/claude|codex|openai|anthropic|gpt/i);
      expect(w).not.toMatch(/\b[A-Z]{3,}_[A-Z_]+\b|D-\d{4}|mandate|clause|capture|_set\b/);
    }
    // Scale finding #10: the list is not titled by the week (it holds every purchase).
    expect(SPEND_VIEWS.week).not.toMatch(/week/i);
  });
});
