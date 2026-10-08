import { describe, expect, it, beforeEach } from 'vitest';
import { clockLabel, countdown, formatMinor, shortHash, shortId } from './format';
import { WalletError, toWalletError } from './contract';
import { mockBackend, resetMockState } from '../mock/backend';
import { fakeHash, fakeUlid } from '../mock/fixtures';

describe('money formatting (display only - Rust owns the arithmetic)', () => {
  it('formats exact minor units without float rounding', () => {
    expect(formatMinor(32900, 'USD')).toBe('$329.00');
    expect(formatMinor(1196000, 'USD')).toBe('$11,960.00');
    expect(formatMinor(5, 'USD')).toBe('$0.05');
    expect(formatMinor(-960, 'USD')).toBe('−$9.60');
    expect(formatMinor(1234, 'JPY')).toBe('1,234 JPY');
    expect(formatMinor(1500, 'KWD')).toBe('1.500 KWD');
  });
  it('counts down from absolute deadlines', () => {
    expect(countdown(1000 + 3 * 3600 + 57 * 60 + 56, 1000)).toBe('3:57:56');
    expect(countdown(1000 + 2 * 86400 + 19 * 3600, 1000)).toBe('2 days 19 h');
    expect(countdown(1000 + 86400 + 3 * 3600 + 59 * 60, 1000)).toBe('1 day 3 h');
    expect(countdown(1000 + 3 * 86400 + 30 * 60, 1000)).toBe('3 days');
    expect(countdown(1000 + 86400 - 1, 1000)).toBe('23:59:59');
    expect(countdown(500, 1000)).toBe('0:00:00');
  });
  it('says a weekday for times this week and the date for times further away', () => {
    const now = Math.floor(new Date(2026, 9, 7, 23, 9).getTime() / 1000); // Wed 7 Oct 2026, local
    expect(clockLabel(now - 3600, now)).toBe('Wed 22:09');
    expect(clockLabel(now + 4 * 86400, now)).toBe('Sun 23:09');
    expect(clockLabel(now + 27 * 86400, now)).toMatch(/^3 Nov \d\d:\d\d$/); // a daylight-saving change may move the hour
    expect(clockLabel(now - 9 * 86400, now)).toMatch(/^28 Sep\w* \d\d:\d\d$/);
  });
  it('shortens ids and hashes', () => {
    expect(shortId('01JDABCDEFGHJKMNPQRSTVWX7Q')).toBe('01JD…7Q');
    expect(shortHash(fakeHash('x'))).toMatch(/^[0-9a-f]{4}…[0-9a-f]{2}$/);
  });
});

describe('typed failures', () => {
  it('keeps a Rust CommandError', () => {
    const e = toWalletError({ code: 'LOCKED', message: 'idle' });
    expect(e).toBeInstanceOf(WalletError);
    expect(e.code).toBe('LOCKED');
    expect(e.isAvailabilityState).toBe(false);
  });
  it('keeps a mandate refusal distinct from malformed input', () => {
    expect(toWalletError({ code: 'REFUSED', message: 'mandate clause 3: above max_amount' }).code).toBe('REFUSED');
    expect(toWalletError({ code: 'INVALID', message: 'bad shape' }).code).toBe('INVALID');
  });

  it('treats an unregistered command as UNAVAILABLE, not a crash', () => {
    const e = toWalletError('command deal_transcript not found');
    expect(e.code).toBe('UNAVAILABLE');
    expect(e.isAvailabilityState).toBe(true);
  });
});

describe('mock backend mirrors the shell gates', () => {
  beforeEach(() => resetMockState());
  const dealId = fakeUlid('D-0193');

  it('refuses privileged commands outside the approval window', async () => {
    const main = mockBackend('main');
    const args = { deal_id: dealId, attempt: 1, terms_hash: fakeHash('t') };
    await expect(main.invoke('deal_countersign', args)).rejects.toMatchObject({ code: 'PERMISSION' });
    await expect(main.invoke('approval_token', null)).rejects.toMatchObject({ code: 'PERMISSION' });
  });
  it('requires the capability token in the approval window', async () => {
    const held = fakeUlid('D-0190');
    history.replaceState(null, '', `/approval.html?deal=${held}`);
    const approval = mockBackend('approval');
    const { checks_hash } = await approval.invoke('approval_summary', { deal_id: held });
    const args = { deal_id: held, attempt: 1, terms_hash: fakeHash('t'), checks_hash };
    await expect(approval.invoke('deal_capture', args)).rejects.toMatchObject({ code: 'PERMISSION' });
    const token = await approval.invoke('approval_token', null);
    const deal = await approval.invoke('deal_capture', args, { token });
    expect(deal.state).toBe('CAPTURED');
  });
  it('does not countersign a buyer haggle still negotiating (Rust needs AGREED/APPROVED)', async () => {
    history.replaceState(null, '', `/approval.html?deal=${dealId}`);
    const approval = mockBackend('approval');
    const token = await approval.invoke('approval_token', null);
    await expect(approval.invoke('deal_countersign', { deal_id: dealId, attempt: 1, terms_hash: fakeHash('t') }, { token })).rejects.toMatchObject({ code: 'INVALID' });
  });
  it('never fakes a proof export and keeps it out of the Tumbler', async () => {
    await expect(mockBackend('main').invoke('deal_export_proof', { deal_id: dealId })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(mockBackend('tumbler').invoke('deal_export_proof', { deal_id: dealId })).rejects.toMatchObject({ code: 'PERMISSION' });
    await expect(mockBackend('main').invoke('proof_check', null)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(mockBackend('approval').invoke('proof_check', null)).rejects.toMatchObject({ code: 'PERMISSION' });
  });
  it('approves a rescue fix only as Rust does: bound to the checklist, the terms and a waiting fix', async () => {
    const rescue = fakeUlid('D-0188');
    history.replaceState(null, '', `/approval.html?deal=${rescue}`);
    const approval = mockBackend('approval');
    const token = await approval.invoke('approval_token', null);
    // Like Rust: the decision is bound to the checklist first, then the terms.
    await expect(approval.invoke('rescue_approve', { deal_id: rescue, attempt: 1, terms_hash: fakeHash('t') }, { token })).rejects.toMatchObject({ code: 'INVALID', message: 'The summary changed. Review it again.' });
    const s = await approval.invoke('approval_summary', { deal_id: rescue });
    expect(s.rescue?.offer).toMatchObject({ lever: 'DISCOUNT_THIS_CYCLE', cycle: { minor: 1200 }, discount: { minor: 240 }, invoice: { minor: 960 }, discount_bp: 2000 });
    expect(s.rescue?.text.note).toContain('20% off: 9.60 USD instead of 12.00 USD');
    expect(s.checks.find((c) => c.id === 'amount')?.text).toBe('The invoice asks $9.60: 20% off this cycle’s $12.00.');
    expect(s.checks.every((c) => c.status !== 'fail')).toBe(true);
    expect(s.can_release).toBe(true);
    await expect(approval.invoke('rescue_approve', { deal_id: rescue, attempt: 1, terms_hash: fakeHash('t'), checks_hash: s.checks_hash }, { token })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(mockBackend('main').invoke('rescue_approve', { deal_id: rescue, attempt: 1, terms_hash: s.terms_hash, checks_hash: s.checks_hash })).rejects.toMatchObject({ code: 'PERMISSION' });
    const deal = await approval.invoke('rescue_approve', { deal_id: rescue, attempt: 1, terms_hash: s.terms_hash, checks_hash: s.checks_hash }, { token });
    expect(deal).toMatchObject({ state: 'AWAITING_APPROVAL', decided_by: { type: 'human' } });
    expect(deal.paypal.order).toMatch(/^INV2-/);
    // Sent is not paid, and this failure was replayed: nothing counts as recovered.
    const book = await mockBackend('main').invoke('rescue_book', null);
    expect(book.cases.find((v) => v.deal_id === rescue)).toMatchObject({ counted: false, invoice: deal.paypal.order });
    expect(book.recovered).toEqual([{ minor: 900, currency: 'USD' }]);
    // A second approval finds no waiting fix.
    const again = await approval.invoke('approval_summary', { deal_id: rescue });
    expect(again.can_release).toBe(false);
  });
  it('replays a failed renewal only in the approval window, under signed fixes rules, and rebinds the window to it', async () => {
    history.replaceState(null, '', '/approval.html?target=rescue');
    const approval = mockBackend('approval');
    const token = await approval.invoke('approval_token', null);
    const args = { subscription_id: 'I-BW452GLLEP1G', subscriber_email: 'sam@example.com', plan: 'care-plan', amount: { minor: 1500, currency: 'USD' as const } };
    await expect(mockBackend('main').invoke('rescue_replay', args)).rejects.toMatchObject({ code: 'PERMISSION' });
    await expect(approval.invoke('rescue_replay', args)).rejects.toMatchObject({ code: 'PERMISSION' });
    await expect(approval.invoke('rescue_replay', { ...args, subscriber_email: 'sam' }, { token })).rejects.toMatchObject({ code: 'INVALID', message: 'That is not an email address.' });
    await expect(approval.invoke('rescue_replay', { ...args, subscription_id: 'I BW' }, { token })).rejects.toMatchObject({ code: 'INVALID', message: 'That is not a PayPal subscription id.' });
    const deal = await approval.invoke('rescue_replay', args, { token });
    expect(deal).toMatchObject({ kind: 'rescue', state: 'AGREED', mode: 'replay', terms: { unit_price: { minor: 1200 } } });
    expect(await approval.invoke('approval_selection', null)).toBe(deal.id);
    const s = await approval.invoke('approval_summary', { deal_id: deal.id });
    expect(s.rescue).toMatchObject({ source: 'replay', recipient: 's•••@example.com', counted: false, offer: { discount: { minor: 300 } } });
  });
  it('sorts attention by deadline and keeps the default-on-silence line', async () => {
    const tumbler = mockBackend('tumbler');
    const snap = await tumbler.invoke('attention_list', null);
    expect(snap.items.length).toBeGreaterThan(0);
    const deadlines = snap.items.map((i) => i.deadline ?? Infinity);
    expect([...deadlines].sort((a, b) => a - b)).toEqual(deadlines);
    snap.items.forEach((i) => expect(i.on_silence.length).toBeGreaterThan(0));
  });
});
