import { describe, expect, it } from 'vitest';
import type { QuitLine } from '@bindings/QuitLine';
import type { QuitSummary } from '@bindings/QuitSummary';
import { quitView } from './quit';

const ID = '01JD00000000000000000000A1';
const line = (o: Partial<QuitLine> & Pick<QuitLine, 'effect' | 'text'>): QuitLine =>
  ({ deal_id: ID, label: 'D-0189', amount_minor: 9000, currency: 'USD', ...o });
const summary = (o: Partial<QuitSummary> = {}): QuitSummary =>
  ({ confirmation_id: [], pending: [ID], on_quit: 'Quitting stops the wallet.', ...o } as unknown as QuitSummary);

describe('quit sheet', () => {
  it('groups what stops and what PayPal still does, with the deal number and amount', () => {
    const v = quitView(summary({
      while_off: [line({ effect: 'not_collected_if_approved', text: 'If the buyer approves on PayPal, the payment is not collected until you open The Table again.' })],
      at_paypal: [line({ effect: 'request_runs_out', text: 'If it is not approved on PayPal in time, the payment request runs out there by itself. No money moves.' })],
    }));
    expect(v.lead).toBe('1 deal is still open.');
    expect(v.unknown).toBe(false);
    expect(v.sections.map((s) => [s.key, s.title, s.rows.map((r) => `${r.label} · ${r.amount}`)])).toEqual([
      ['while_off', 'Won’t happen while The Table is off', ['D-0189 · $90.00']],
      ['at_paypal', 'Still happens at PayPal, by itself', ['D-0189 · $90.00']],
    ]);
    expect(v.sections[0]?.rows[0]?.text).toMatch(/^If the buyer approves/);
    // the sheet names the deal by its title from the ledger, so each row keeps the deal id
    expect(v.sections.flatMap((s) => s.rows.map((r) => r.dealId))).toEqual([ID, ID]);
    expect(v.note).toBe('Quitting stops the wallet.');
  });

  it('says nothing per deal is known when an older shell or a failed read sends no lines', () => {
    const v = quitView(summary({ pending: [ID, ID], while_off: null }));
    expect(v.lead).toBe('2 deals are still open.');
    expect(v.unknown).toBe(true);
    expect(v.sections).toEqual([]);
    // an older shell omits the fields entirely
    expect(quitView(summary()).unknown).toBe(true);
  });

  it('has nothing pending with no open deals', () => {
    const v = quitView(summary({ pending: [], while_off: [], at_paypal: [] }));
    expect(v.lead).toBe('Nothing is waiting for you.');
    expect(v.sections).toEqual([]);
    expect(v.unknown).toBe(false);
  });
});
