import { describe, expect, it } from 'vitest';
import { currencyMark, minorToText as fmtInput, parseMoneyText as one, shortMoney } from './format';
import { parseMoneyInput } from '../windows/approval/model';
import { fmtShort, minorToText, parseMoneyText } from '../windows/main/modules/counter/model';
import { parseAmount, short, toInput } from '../windows/main/modules/tables/ladder';

// Typed money, one rule (AGENTS.md: integer minor units, decimals parsed from the string, never a float).
const ROWS: Array<[string, 'USD' | 'JPY' | 'KWD', number | null]> = [
  ['58', 'USD', 5800],
  ['58.', 'USD', 5800],
  ['$ 58', 'USD', 5800],
  ['$58.50', 'USD', 5850],
  ['58,50', 'USD', null], // a comma only groups thousands
  ['1,058', 'USD', 105800],
  ['1,058.50', 'USD', 105850],
  ['0.1', 'USD', 10],
  ['58.555', 'USD', null],
  ['12345678901', 'USD', null],
  ['5 8', 'USD', null],
  ['.5', 'USD', null],
  ['', 'USD', null],
  ['5.5', 'JPY', null],
  ['500', 'JPY', 500],
  ['1.234', 'KWD', 1234],
];

describe('typed money has one parser', () => {
  it.each(ROWS)('%j (%s) -> %j in the counter, the ladder and the approval window', (text, cur, want) => {
    expect({ counter: parseMoneyText(text, cur), ladder: parseAmount(text, cur), approval: parseMoneyInput(text, cur) }).toEqual({ counter: want, ladder: want, approval: want });
  });
  it('shortens whole amounts and renders the editable text the same everywhere', () => {
    for (const [m, c] of [[5800, 'USD'], [5850, 'USD'], [0, 'USD'], [500, 'JPY'], [1234, 'KWD'], [1000, 'KWD']] as const) {
      expect(fmtShort(m, c), `${m} ${c}`).toBe(short(m, c));
      expect(minorToText(m, c), `${m} ${c}`).toBe(toInput(m, c));
    }
  });
  it('the three modules are views of the one implementation in lib/format', () => {
    expect([parseMoneyText, parseAmount, parseMoneyInput]).toEqual([one, one, one]);
    expect(parseAmount).toBe(one);
    expect(parseMoneyInput).toBe(one);
    expect(fmtShort).toBe(shortMoney);
    expect(short).toBe(shortMoney);
    expect(minorToText).toBe(fmtInput);
    expect(toInput).toBe(fmtInput);
    expect(currencyMark('CHF')).toBe('CHF');
    expect(currencyMark('USD')).toBe('$');
  });
});
