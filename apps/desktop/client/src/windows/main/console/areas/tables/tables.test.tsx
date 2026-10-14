// The Tables layer on the mock worlds (rebuild WP3a): the summary and every nested view render on the
// small shop and the busy merchant with no console error, no raw enum or id on screen, bounded rows
// and the read budget; the transcript is read only for the table that is open (never per row); the
// decision hands off with `approval_open` and nothing else; search, filter and picking work; an empty
// view shrinks to its one calm line; and the area's words keep the vendor and internals rules.
import { act, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TABLES, TABLES_TRADE, TABLES_VIEWS } from '../../../../../lib/words';
import { expectLayerHealthy, renderLayerAtScale, type LayerRun } from '../../testing/scaleSmoke';
import { wordsOf } from './wordsOf';

vi.mock('../../../../../lib/runtime', async () => (await import('../../testing/runtime')).runtimeMock);

afterEach(() => { cleanup(); history.replaceState(null, '', '/'); });

const reads = (r: LayerRun, cmd: string) => r.calls.filter((c) => c.cmd === cmd).length;
const acts = (r: LayerRun) => r.calls.filter((c) => !/^(list_|get_|deal_display|deal_transcript|deal_evidence|deal_groups|attention_list|agent_runs|counterparty_|mandate_list|engine_status|safety_record|deal_history|approval_open)/.test(c.cmd));

describe('Tables at scale', () => {
  it.each(['small', 'large'] as const)('summary on the %s world', async (scale) => {
    const r = await renderLayerAtScale({ level: 'module', module: 'tables' }, scale);
    expect(r.layer.dataset.layer).toBe('tables');
    expectLayerHealthy(r);
    const cards = r.layer.querySelectorAll('.ml-cards .ui-sumcard');
    expect(cards.length).toBeGreaterThanOrEqual(3);
    expect(cards.length).toBeLessThanOrEqual(4);
    if (scale === 'large') {
      // The waiting decisions: the Your call chip and the needs-you card both say what silence does.
      expect(r.layer.querySelector('[data-fk="your-call"]')).toBeTruthy();
      expect(r.layer.querySelector('.ui-sumcard.needs')?.textContent).toMatch(/If you do nothing/);
    } else {
      expect(r.layer.querySelector('h1')?.textContent).toBe(TABLES.answerNone);
    }
    // The summary reads no transcript at all.
    expect(reads(r, 'deal_transcript')).toBe(0);
  }, 60_000);

  it.each(['need', 'tables', 'ladder', 'shop', 'closed'] as const)('the %s view on the busy world', async (view) => {
    const r = await renderLayerAtScale({ level: 'module', module: 'tables', view }, 'large');
    expectLayerHealthy(r);
    expect(r.layer.querySelector('h1')?.textContent).toBe(TABLES_VIEWS[view]);
    // Visible-only reads: one table open, so at most one transcript (plus one trailing refresh).
    expect(reads(r, 'deal_transcript')).toBeLessThanOrEqual(2);
    expect(acts(r)).toEqual([]);
  }, 60_000);

  it('an empty view shrinks to its calm line (small shop: no tables)', async () => {
    const r = await renderLayerAtScale({ level: 'module', module: 'tables', view: 'tables' }, 'small');
    expect(r.layer.querySelector('.tr-split.empty')).toBeTruthy();
    expect(r.layer.querySelector('.tr-pane')).toBeNull();
    expect(r.layer.textContent).toContain(TABLES.openEmpty);
  }, 60_000);
});

describe('Tables flows', () => {
  it('the decision hands off to the approval window and nothing else', async () => {
    const r = await renderLayerAtScale({ level: 'module', module: 'tables', view: 'need' }, 'large');
    const pane = () => r.layer.querySelector<HTMLElement>('.tr-pane') as HTMLElement;
    const goldIn = () => within(pane()).queryAllByRole('button').find((b) => b.classList.contains('dc-opt') && b.classList.contains('gold'));
    // Pick tables until one asks for a review (a mismatch has no gold, only "Open the deal").
    const rows = [...r.layer.querySelectorAll<HTMLButtonElement>('.tr-list .le-row')];
    for (const row of rows) {
      if (goldIn()) break;
      act(() => { row.click(); });
      await waitFor(() => expect(pane().textContent).toMatch(/If you do nothing/));
    }
    const gold = goldIn();
    expect(gold).toBeTruthy();
    fireEvent.click(gold as HTMLElement);
    await waitFor(() => expect(r.calls.some((c) => c.cmd === 'approval_open')).toBe(true));
    const opened = r.calls.filter((c) => c.cmd === 'approval_open');
    expect(opened).toHaveLength(1);
    expect(Object.keys(opened[0]?.args as object)).toEqual(['deal_id']);
    // Every needs-you decision says what happens if the owner does nothing.
    expect(pane().textContent).toMatch(/If you do nothing/);
    expect(acts(r)).toEqual([]);
  }, 60_000);

  it('search narrows the list and picking a table opens it beside the list', async () => {
    const r = await renderLayerAtScale({ level: 'module', module: 'tables', view: 'tables' }, 'large');
    const list = r.layer.querySelector<HTMLElement>('.tr-list');
    const rows = () => [...(list?.querySelectorAll<HTMLButtonElement>('.le-row') ?? [])];
    expect(rows().length).toBeGreaterThan(1);
    const second = rows()[1];
    const label = second?.getAttribute('aria-label') ?? '';
    act(() => { second?.click(); });
    await waitFor(() => expect(label.startsWith(`${r.layer.querySelector('.tr-pane h2')?.textContent ?? '-'}, `)).toBe(true));
    const before = rows().length;
    const search = list?.querySelector<HTMLInputElement>('input[type="search"]');
    if (search) {
      fireEvent.change(search, { target: { value: 'zzzz-no-such-table' } });
      await waitFor(() => expect(list?.textContent).toMatch(/Nothing matches/));
      fireEvent.change(search, { target: { value: '' } });
      await waitFor(() => expect(rows().length).toBe(before));
    }
  }, 60_000);

  it('an ended table opens its deal one layer down', async () => {
    const r = await renderLayerAtScale({ level: 'module', module: 'tables', view: 'closed' }, 'large');
    const paid = [...r.layer.querySelectorAll<HTMLButtonElement>('.ui-filter')].find((b) => b.textContent?.startsWith(TABLES.fPaid));
    act(() => { paid?.click(); });
    await waitFor(() => expect(paid?.getAttribute('aria-pressed')).toBe('true'));
    const row = r.layer.querySelector<HTMLButtonElement>('.le-row');
    act(() => { row?.click(); });
    await waitFor(() => expect(location.hash).toMatch(/^#d=/));
  }, 60_000);
});

describe('Tables words', () => {
  it('never name a vendor other than PayPal, an engine, a raw state or an id', () => {
    for (const w of [...wordsOf(TABLES), ...wordsOf(TABLES_TRADE), ...wordsOf(TABLES_VIEWS)]) {
      expect(w).not.toMatch(/claude|codex|openai|anthropic|gpt/i);
      expect(w).not.toMatch(/\b[A-Z]{3,}_[A-Z_]+\b|D-\d{4}|mandate|clause|countersign|_set\b/);
    }
  });
});
