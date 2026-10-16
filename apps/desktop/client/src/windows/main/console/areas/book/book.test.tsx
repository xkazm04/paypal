// The Book layer on the mock world (rebuild WP3b): the summary at both scales, the footer's "paid out
// today" and the Book's agree and leave holds out (#9), the outlook's count and amount describe the
// same set (#8), the ledger is windowed and reads PayPal evidence only for the rows in view (#17),
// the record reads 200 steps at a time and on (#16), a typed question is answered read-only, and
// nothing but reads is ever sent.
import { act, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatMinor } from '../../../../../lib/format';
import { BOOK, BOOK_VIEWS_TITLE, IF_NOTHING } from '../../../../../lib/words';
import { mockBackend } from '../../../../../mock/backend';
import { sumByCurrency } from '../../../logic';
import { expectLayerHealthy, renderLayerAtScale, settle } from '../../testing/scaleSmoke';
import { paidOutIn, walletDay } from './model';

vi.mock('../../../../../lib/runtime', async () => (await import('../../testing/runtime')).runtimeMock);

afterEach(() => { cleanup(); history.replaceState(null, '', '/'); });

const heading = (el: HTMLElement) => el.querySelector('[data-layer-title]')?.textContent ?? '';

describe('Book summary', () => {
  it.each(['small', 'large'] as const)('answers in one line with four cards (%s)', async (scale) => {
    const r = await renderLayerAtScale('#m=book', scale);
    expectLayerHealthy(r);
    expect(heading(r.layer)).toMatch(/^(This week|Nothing yet)/);
    expect(r.layer.querySelectorAll('.ml-cards .ui-sumcard')).toHaveLength(4);
    // The summary reads no PayPal evidence: only the views that draw a statement do.
    expect(r.budget.byCommand.get('deal_evidence')?.total ?? 0).toBe(0);
  }, 60_000);

  it('the footer shows money paid today, never held money, and the Book says the same figure (#9)', async () => {
    const r = await renderLayerAtScale('#m=book', 'large');
    const w = mockBackend('main');
    const [deals, att] = await Promise.all([w.invoke('list_deals', null), w.invoke('attention_list', null)]);
    const row = att.exposure?.currencies.length === 1 ? att.exposure.currencies[0] : undefined;
    expect(row, 'the large world pays out in one currency').toBeDefined();
    if (!row || !att.exposure) return;
    const checking = new Set(att.items.filter((n) => n.money_check).map((n) => n.deal_id));
    const paid = paidOutIn(deals, walletDay(att.exposure.day_start), (d) => checking.has(d.id)).money;
    const text = paid.map((m) => formatMinor(m.minor, m.currency)).join(' · ');
    const meter = document.querySelector('[data-meter="paid-today"] b');
    expect(meter?.textContent).toBe(text);
    // The large world holds money today: the meter is not the day's budget (which counts holds).
    expect(row.out_today.minor).toBeGreaterThan(row.held.minor);
    expect(meter?.textContent).not.toBe(formatMinor(row.out_today.minor, row.out_today.currency));
    expect(r.layer.querySelector('[data-card="ledger"]')?.textContent).toContain(BOOK.cards.today(text));
  }, 60_000);
});

describe('Book outlook (#8)', () => {
  it('each line counts a set and shows the money of exactly that set, the soonest apart', async () => {
    const r = await renderLayerAtScale('#m=book&v=outlook', 'large');
    expectLayerHealthy(r);
    const w = mockBackend('main');
    const [deals, att] = await Promise.all([w.invoke('list_deals', null), w.invoke('attention_list', null)]);
    const checking = new Set(att.items.filter((n) => n.money_check).map((n) => n.deal_id));
    const holds = deals.filter((d) => d.state === 'AUTHORIZED' && !checking.has(d.id));
    const line = r.layer.querySelector<HTMLElement>('[data-ol="holds"]');
    expect(line?.querySelector('.bk-ol-n')?.textContent).toBe(String(holds.length));
    const total = sumByCurrency(holds.map((d) => ({ minor: d.terms.unit_price.minor * d.terms.qty, currency: d.terms.currency })));
    for (const m of total) expect(line?.textContent).toContain(formatMinor(m.minor, m.currency));
    expect(line?.textContent).toContain(BOOK.soonest);
    expect(line?.textContent).toContain(IF_NOTHING);
  }, 60_000);
});

describe('Book ledger', () => {
  it('is windowed and reads PayPal evidence only for the rows in view (#17)', async () => {
    const r = await renderLayerAtScale('#m=book&v=ledger', 'large');
    expectLayerHealthy(r);
    expect(heading(r.layer)).toBe(BOOK_VIEWS_TITLE.ledger);
    const rows = r.layer.querySelectorAll('.le-item').length;
    expect(rows).toBeGreaterThan(0);
    expect(rows).toBeLessThan(60);
    expect(r.budget.byCommand.get('deal_evidence')?.total ?? 0).toBeLessThanOrEqual(rows);
  }, 60_000);

  it('searches, says when nothing matches, and Escape clears the search first', async () => {
    const r = await renderLayerAtScale('#m=book&v=ledger', 'large');
    const box = within(r.layer).getByRole('searchbox');
    fireEvent.change(box, { target: { value: 'no deal is called this' } });
    await waitFor(() => expect(r.layer.textContent).toContain(BOOK.list.noMatch));
    fireEvent.keyDown(box, { key: 'Escape' });
    await waitFor(() => expect(r.layer.querySelectorAll('.le-item').length).toBeGreaterThan(0));
    expect(location.hash).toContain('v=ledger');
  }, 60_000);

  it('everything on record is one switch away, still windowed', async () => {
    const r = await renderLayerAtScale('#m=book&v=ledger', 'large');
    fireEvent.click(within(r.layer).getByRole('button', { name: BOOK.scope.all }));
    await settle();
    expect(r.layer.textContent).toContain(BOOK.ledgerSubAll((await mockBackend('main').invoke('list_deals', null)).length));
    expect(r.rows()).toBeLessThanOrEqual(250);
  }, 60_000);
});

describe('Book record (#16)', () => {
  it('reads 200 steps at a time, keeps the page bounded, and reads on', async () => {
    const r = await renderLayerAtScale('#m=book&v=record', 'large');
    expectLayerHealthy(r);
    const pages = () => r.calls.filter((c) => c.cmd === 'audit_page');
    expect(pages()[0]?.args).toMatchObject({ limit: 200 });
    await act(async () => { fireEvent.click(within(r.layer).getByRole('button', { name: BOOK.record.older })); });
    await settle();
    expect(pages()).toHaveLength(2);
    expect((pages()[1]?.args as { before: number }).before).toBeGreaterThan(0);
    expect(r.rows()).toBeLessThanOrEqual(250);
  }, 60_000);
});

describe('Ask your book', () => {
  it('answers a typed question read-only, with the deals behind it', async () => {
    const r = await renderLayerAtScale('#m=book&v=ask', 'large');
    const box = within(r.layer).getByRole('textbox', { name: BOOK.ask.label });
    fireEvent.change(box, { target: { value: 'How much was paid this week, by shop?' } });
    await act(async () => { fireEvent.submit(box.closest('form') as HTMLFormElement); });
    await settle();
    expect(r.calls.some((c) => c.cmd === 'book_query')).toBe(true);
    expect(r.layer.textContent).toMatch(/I read this as:|I didn’t understand/);
    expectLayerHealthy(r);
  }, 60_000);
});
