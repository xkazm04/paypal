import { describe, expect, it } from 'vitest';
import { recordSearchTerm } from './Record';

describe('recordSearchTerm', () => {
  it('turns an owner word into the stored word', () => {
    expect(recordSearchTerm('Paid')).toBe('CAPTURED');
    expect(recordSearchTerm('  paid ')).toBe('CAPTURED');
    expect(recordSearchTerm('On hold')).toBe('AUTHORIZED');
    expect(recordSearchTerm('A deal started')).toBe('deal.created');
    expect(recordSearchTerm('You')).toBe('owner');
  });
  it('uses a shared stored word when two statuses read the same', () => {
    expect(recordSearchTerm('Hold released')).toBe('VOIDED');
  });
  it('a prefix of exactly one word is that word; otherwise the text is searched as typed', () => {
    expect(recordSearchTerm('Disp')).toBe('DISPUTED');
    expect(recordSearchTerm('paper clips')).toBe('paper clips');
    expect(recordSearchTerm('')).toBe('');
  });
});
