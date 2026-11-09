// The Book layer on the mock world (rebuild WP3b): the summary at both scales, the footer's "paid out
// today" and the Book's agree and leave holds out (#9), the outlook's count and amount describe the
// same set (#8), the ledger is windowed and reads PayPal evidence only for the rows in view (#17),
// the record reads 200 steps at a time and on (#16), a typed question is answered read-only, and
// nothing but reads is ever sent.
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatMinor } from '../../../../../lib/format';
import type { AuditRow } from '@bindings/AuditRow';
import type { Deal } from '@bindings/Deal';
import { BOOK, BOOK_VIEWS_TITLE, IF_NOTHING, stateWord } from '../../../../../lib/words';
import { mockBackend } from '../../../../../mock/backend';
import { sumByCurrency } from '../../../logic';
import { QUESTION_WORDS } from '../../../modules/book/where';
import { expectLayerHealthy, renderLayerAtScale, settle } from '../../testing/scaleSmoke';
import { dealsIn, outsideSpan, paidOutIn, walletDay, weekSpan } from './model';
import { WalletAnswer } from './Ask';
import { stepChange } from './Record';
import { WalletError } from '../../../../../lib/contract';
import { runtimeMock, setHarnessBackend } from '../../testing/runtime';

vi.mock('../../../../../lib/runtime', async () => (await import('../../testing/runtime')).runtimeMock);

// The summary's compact cards show a note only when the card has no 'if you do nothing' line, so a test of
// the note reads the cards the layer hands the summary, not the drawn text.
const drawn = vi.hoisted(() => ({ cards: [] as readonly { id: string; note?: unknown }[] }));
vi.mock('../../ModuleSummary', async (original) => {
  const real = await original<typeof import('../../ModuleSummary')>();
  return { ...real, ModuleSummary: (p: Parameters<typeof real.ModuleSummary>[0]) => { drawn.cards = p.cards; return real.ModuleSummary(p); } };
});

const PINNED_INSTANTS = [
  ['Monday 09:00', new Date(Date.UTC(2026, 9, 19, 9, 0))],
  ['Wednesday 15:00', new Date(Date.UTC(2026, 9, 21, 15, 0))],
  ['Sunday 23:30', new Date(Date.UTC(2026, 9, 25, 23, 30))],
] as const;

afterEach(() => { vi.useRealTimers(); cleanup(); history.replaceState(null, '', '/'); });

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

  // The mock world is built from the real clock, so the day it lands on moves the figures: pin the instant
  // (UTC: the wallet's day starts at 00:00 UTC; Date only) to a week's first morning, midweek and its last night.
  it.each(PINNED_INSTANTS)('the footer shows money paid today, never held money, and the Book says the same figure (#9) — %s', async (_name, at) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at);
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
    // The large world holds money that moved today: the meter is not the day's budget (which counts holds). How much
    // was paid so far depends on the hour, so this asserts the holds are there, not that they are the larger part.
    expect(row.held.minor).toBeGreaterThan(0);
    expect(row.out_today.minor).toBeGreaterThan(paid.reduce((t, m) => t + m.minor, 0));
    expect(meter?.textContent).not.toBe(formatMinor(row.out_today.minor, row.out_today.currency));
    // The compact chip keeps the figure's note as its tooltip, not as text.
    expect(r.layer.querySelector('[data-card="ledger"]')?.getAttribute('title')).toContain(BOOK.cards.today(text));
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

  // The summary's Outlook card counts every deal that waits (any week, money out or in) and opens the
  // outlook view; the held money beside that count is the holds line of that same view. Before, it
  // was this week's money-out holds only: the large world's incoming hold was left out of the card.
  it('the Outlook card says the held money of the holds the outlook counts', async () => {
    const r = await renderLayerAtScale('#m=book', 'large');
    const w = mockBackend('main');
    const [deals, att] = await Promise.all([w.invoke('list_deals', null), w.invoke('attention_list', null)]);
    const checking = new Set(att.items.filter((n) => n.money_check).map((n) => n.deal_id));
    const holds = deals.filter((d) => d.state === 'AUTHORIZED' && !checking.has(d.id));
    expect(holds.some((d) => d.side === 'seller'), 'the large world holds money coming in').toBe(true);
    const held = sumByCurrency(holds.map((d) => ({ minor: d.terms.unit_price.minor * d.terms.qty, currency: d.terms.currency })))
      .map((m) => formatMinor(m.minor, m.currency)).join(' · ');
    void r;
    expect(drawn.cards.find((c) => c.id === 'outlook')?.note).toBe(BOOK.cards.outlookNote(held));
  }, 60_000);
});

describe('Book ledger', () => {
  it('is windowed and reads PayPal evidence only for the rows in view (#17)', async () => {
    const r = await renderLayerAtScale('#m=book&v=ledger', 'large');
    expectLayerHealthy(r);
    expect(heading(r.layer)).toBe(BOOK_VIEWS_TITLE.ledger);
    await waitFor(() => expect(r.layer.querySelectorAll('.sg-grid .ag-center-cols-container .ag-row').length).toBeGreaterThan(0));
    const rows = r.layer.querySelectorAll('.sg-grid .ag-center-cols-container .ag-row').length;
    expect(rows).toBeLessThan(60);
    expect(r.budget.byCommand.get('deal_evidence')?.total ?? 0).toBeLessThanOrEqual(rows);
  }, 60_000);

  it('draws the ledger as a grid: column headers and filters, no pager, the quick search box', async () => {
    const r = await renderLayerAtScale('#m=book&v=ledger', 'large');
    await waitFor(() => expect(r.layer.querySelector('.sg-grid .ag-header')).not.toBeNull());
    const headers = [...r.layer.querySelectorAll('.sg-grid .ag-header-cell-text')].map((e) => e.textContent);
    expect(headers).toEqual(expect.arrayContaining([BOOK.col.when, BOOK.col.what, BOOK.col.status, BOOK.col.amount]));
    expect(r.layer.querySelector('.pg-range')).toBeNull();
    expect(within(r.layer).getByRole('searchbox')).toBeTruthy();
  }, 60_000);

  // "PayPal agrees" counts the week's payments that need a place on the statement. A deal whose
  // statement was never read (a hold, a deal still agreed, one that stopped) is not "couldn't be
  // checked": before, every week deal outside the paid bucket read as unknown (small world: "2 of 9",
  // 6 unknown, against 3 that need the statement), and a seller-attested deal PayPal matched was
  // one of them.
  it.each(['small', 'large'] as const)('PayPal agrees counts only payments that need the statement (%s)', async (scale) => {
    const r = await renderLayerAtScale('#m=book&v=ledger', scale);
    const w = mockBackend('main');
    const week = dealsIn(await w.invoke('list_deals', null), weekSpan(Math.floor(Date.now() / 1000)));
    let needed = 0;
    let matched = 0;
    for (const d of week) {
      const ev = await w.invoke('deal_evidence', { deal_id: d.id });
      if (ev.reconciliation !== 'not_applicable') needed += 1;
      if (ev.reconciliation === 'matched') matched += 1;
    }
    const went = r.layer.querySelector<HTMLDetailsElement>('details.bk-went');
    expect(went).not.toBeNull();
    await act(async () => { if (went) { went.open = true; fireEvent(went, new Event('toggle')); } });
    await settle();
    expect(r.layer.querySelector('.ag-fig')?.textContent).toBe(`${matched} of ${needed}`);
    expect(r.layer.querySelector('.ag-key')?.textContent).not.toContain('Unknown');
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
  const pagesOf = (r: Awaited<ReturnType<typeof renderLayerAtScale>>) => r.calls.filter((c) => c.cmd === 'audit_page');
  it('reads 200 steps at a time, in the database order, and reads on toward an older day', async () => {
    const r = await renderLayerAtScale('#m=book&v=record', 'large');
    expectLayerHealthy(r);
    await waitFor(() => expect(r.layer.querySelectorAll('.sg-grid .ag-center-cols-container .ag-row').length).toBeGreaterThan(0));
    expect(pagesOf(r)).toHaveLength(1);
    expect(pagesOf(r)[0]?.args).toMatchObject({ limit: 200, sort: 'newest', filter: null });
    await act(async () => { fireEvent.change(within(r.layer).getByLabelText(BOOK.record.goDay), { target: { value: '2000-01-01' } }); });
    await settle();
    await waitFor(() => expect(pagesOf(r).length).toBeGreaterThan(1));
    expect(pagesOf(r).every((p) => (p.args as { limit: number }).limit === 200)).toBe(true);
    expect((pagesOf(r)[1]?.args as { before: number }).before).toBeGreaterThan(0);
    expect(r.rows()).toBeLessThanOrEqual(250);
  }, 60_000);

  it('searches the whole chain on the server: owner words become stored words, and the count is the true one', async () => {
    const r = await renderLayerAtScale('#m=book&v=record', 'large');
    await waitFor(() => expect(within(r.layer).getByRole('searchbox', { name: BOOK.record.search })).toBeTruthy());
    const w = mockBackend('main');
    const all = await w.invoke('audit_page', { limit: 1 });
    const paid = await w.invoke('audit_page', { limit: 1, filter: 'CAPTURED' });
    await act(async () => { fireEvent.change(within(r.layer).getByRole('searchbox', { name: BOOK.record.search }), { target: { value: 'Paid' } }); });
    await settle();
    await waitFor(() => expect(pagesOf(r).some((p) => (p.args as { filter?: string | null }).filter === 'CAPTURED')).toBe(true));
    await waitFor(() => expect(r.layer.querySelector('.bk-rtools [role="status"]')?.textContent).toBe(BOOK.record.matchingOf(paid.total_matching)));
    // The filter and sort went to the wallet, not over what the page holds.
    expect(paid.total_matching).toBeLessThan(all.total_matching);
  }, 60_000);
});

describe('Book record as a grid', () => {
  it('draws the steps as grid rows on the infinite model', async () => {
    const r = await renderLayerAtScale('#m=book&v=record', 'large');
    await waitFor(() => expect(r.layer.querySelectorAll('.sg-grid .ag-center-cols-container .ag-row').length).toBeGreaterThan(0));
    expect(r.calls.filter((c) => c.cmd === 'audit_page')).toHaveLength(1);
    expect(r.rows()).toBeLessThanOrEqual(250);
  }, 60_000);
});

describe('Book record: Go to a day while a scroll page is out', () => {
  it('waits for the page already being read and goes on reading toward the day', async () => {
    const r = await renderLayerAtScale('#m=book&v=record', 'large');
    const inner = runtimeMock.backend();
    let held: (() => void) | null = null;
    let seen = 0;
    setHarnessBackend({
      ...inner,
      invoke: (cmd, args, opts) => {
        if (cmd !== 'audit_page') return inner.invoke(cmd, args, opts);
        seen += 1;
        if (seen !== 1) return inner.invoke(cmd, args, opts);
        return new Promise((resolve, reject) => { held = () => { inner.invoke(cmd, args, opts).then(resolve, reject); }; });
      },
    });
    const pages = () => r.calls.filter((c) => c.cmd === 'audit_page');
    const before = pages().length;
    // Two jumps: the first's page is out (held) when the second asks; the second must wait, not give up.
    const field = within(r.layer).getByLabelText(BOOK.record.goDay);
    await act(async () => { fireEvent.change(field, { target: { value: '2000-01-02' } }); });
    await act(async () => { fireEvent.change(field, { target: { value: '2000-01-01' } }); });
    await act(async () => { held?.(); });
    await settle();
    // The held page plus at least one more: the jump kept reading after the in-flight page landed.
    await waitFor(() => expect(pages().length - before).toBeGreaterThan(1));
  }, 60_000);
});

describe('Book record when the first page cannot be read', () => {
  // A failed read says so and claims nothing: before, the notice sat over the list's empty state,
  // "Nothing on record yet.", which says the record is empty when it was never read.
  it('shows the notice and not the empty record', async () => {
    const r = await renderLayerAtScale('#m=book', 'large');
    const inner = runtimeMock.backend();
    setHarnessBackend({
      ...inner,
      invoke: (cmd, args, opts) => (cmd === 'audit_page' ? Promise.reject(new WalletError({ code: 'NOT_FOUND', message: 'read failed' })) : inner.invoke(cmd, args, opts)),
    });
    const card = r.layer.querySelector<HTMLElement>('[data-card="record"]');
    expect(card).not.toBeNull();
    await act(async () => { card?.click(); });
    await settle();
    await waitFor(() => expect(document.querySelector('.bk-record [role="alert"]')).not.toBeNull());
    expect(document.querySelector('.bk-record')?.textContent).not.toContain(BOOK.record.empty);
  }, 60_000);
});

describe('Book record step wording', () => {
  // A step's status change is worded like the deal's own status chip (parts.tsx StatusChip passes
  // side AND kind): a rescue's states and a purchase PayPal verified read the same in both places.
  const row = (from: Deal['state'] | null, to: Deal['state']): AuditRow => ({ seq: 1, at: 1, actor: 'pipeline', action: 'deal.transition', deal_id: 'd', decided_by: null, from, to });
  it('says a rescue step in the rescue words, and a purchase receipt as paid', () => {
    expect(stepChange(row('AGREED', 'SETTLING'), { side: 'seller', kind: 'rescue' })).toBe(`${stateWord('AGREED', { side: 'seller', kind: 'rescue' }).text} → ${stateWord('SETTLING', { kind: 'rescue' }).text}`);
    expect(stepChange(row(null, 'AWAITING_APPROVAL'), { side: 'seller', kind: 'rescue' })).toBe('Waiting for subscriber');
    expect(stepChange(row('CAPTURED', 'RECEIPTED'), { side: 'buyer', kind: 'purchase' })).not.toContain('Seller says paid');
    expect(stepChange(row('CAPTURED', 'RECEIPTED'), { side: 'buyer', kind: 'haggle' })).toContain('Seller says paid');
    expect(stepChange({ ...row(null, 'AGREED'), to: null }, undefined)).toBeNull();
  });
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

describe('Ask your book reaches past the week (value-6)', () => {
  it('counts the deals of an answer that fall outside the week list', () => {
    const week = { start: 1_000_000, end: 1_000_000 + 7 * 86_400 };
    const ledger = [{ created_at: 1_000_100, updated_at: 1_000_200 }, { created_at: 10, updated_at: 20 }, { created_at: 30 }];
    expect(outsideSpan(ledger, week)).toBe(2);
    expect(outsideSpan(ledger.slice(0, 1), week)).toBe(0);
    expect(BOOK.ask.line.older(2)).toBe('2 older deals from before this week');
    expect(BOOK.ask.line.older(1)).toBe('1 older deal from before this week');
  });

  it('says on the slip that an answer over the whole ledger is everything on record', async () => {
    const r = await renderLayerAtScale('#m=book&v=ask', 'large');
    fireEvent.click(within(r.layer).getByRole('button', { name: QUESTION_WORDS.decided as string }));
    await act(async () => { fireEvent.click(within(r.layer).getByRole('button', { name: BOOK.ask.show })); });
    await settle();
    const slip = r.layer.querySelector('.bk-slip .bk-sliptext');
    // The question names no time, so it reaches every deal; the large world holds deals older than the week.
    expect(slip?.textContent).toContain(BOOK.ask.line.everything);
  }, 60_000);

  it('reads PayPal statements only for the reconciliation view, never one per deal on record (#17)', async () => {
    const r = await renderLayerAtScale('#m=book&v=ask', 'large');
    fireEvent.click(within(r.layer).getByRole('button', { name: QUESTION_WORDS.decided as string }));
    await act(async () => { fireEvent.click(within(r.layer).getByRole('button', { name: BOOK.ask.show })); });
    await settle();
    const drawn = r.layer.querySelectorAll('.bk-pivot tbody tr').length;
    expect(drawn).toBeGreaterThan(0);
    // A question about who decided draws no statement, so it reads none and never calls one "unknown".
    expect(r.budget.byCommand.get('deal_evidence')?.total ?? 0).toBeLessThanOrEqual(drawn);
    expect(r.layer.querySelector('.bk-pivot')?.textContent).not.toContain(BOOK.ask.statement);
  }, 60_000);
});

describe('Ask your book, an answer cut at its limit', () => {
  const answer = (truncated: boolean) => ({
    query: { view: 'deals', metrics: ['count'], filters: [], group_by: ['counterparty'], range: null, limit: 2 },
    rows: [{ currency: 'USD', mode: 'sandbox', direction: 'out', counterparty: 'a', count: 1 }, { currency: 'USD', mode: 'sandbox', direction: 'out', counterparty: 'b', count: 1 }],
    truncated,
  }) as unknown as Parameters<typeof WalletAnswer>[0]['answer'];
  it('says it shows only the first lines when more matched than the limit', () => {
    const cut = render(<WalletAnswer answer={answer(true)} cpName={(k) => k} />);
    expect(cut.container.textContent).toContain(BOOK.ask.cutLine(2));
    expect(BOOK.ask.cutLine(2)).toMatch(/^Showing the first 2 lines/);
    cut.unmount();
    expect(render(<WalletAnswer answer={answer(false)} cpName={(k) => k} />).container.textContent).not.toContain('Showing the first');
  });
});
