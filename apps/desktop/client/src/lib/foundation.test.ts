import { describe, expect, it, beforeEach } from 'vitest';
import { countdown, formatMinor, shortHash, shortId } from './format';
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
    expect(countdown(1000 + 2 * 86400 + 19 * 3600, 1000)).toBe('2 d 19 h');
    expect(countdown(500, 1000)).toBe('0:00:00');
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
    const args = { deal_id: held, attempt: 1, terms_hash: fakeHash('t') };
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
  });
  it('never fakes the rescue executor', async () => {
    const rescue = fakeUlid('D-0188');
    history.replaceState(null, '', `/approval.html?deal=${rescue}`);
    const approval = mockBackend('approval');
    const token = await approval.invoke('approval_token', null);
    await expect(approval.invoke('rescue_approve', { deal_id: rescue, attempt: 1, terms_hash: fakeHash('t') }, { token })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
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
