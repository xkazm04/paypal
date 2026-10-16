// The listing code: a versioned, checksummed text of a seller's table that a buyer pastes to join it.
import { describe, expect, it } from 'vitest';
import { codeJoinArgs, codeProblem } from './tableDraft';
import { APPROVAL_TABLE } from '../../lib/words';
import { checksum, decodeListingCode, encodeListingCode, type ListingTable } from './listingCode';
import type { MandateListEntry } from '@bindings/MandateListEntry';

const TABLE: ListingTable = {
  dealId: '01JD0000000000000000000ABC',
  category: 'parts',
  terms: { item_ref: 'monitor-24-ips', qty: 2, unit_price: { minor: 12050, currency: 'USD' }, currency: 'USD', delivery: { type: 'digital_now' } },
};
const code = () => encodeListingCode(TABLE) as string;
/** The same code with one field changed and the checksum made right again, as a tampered code would be. */
const resealed = (edit: (f: string[]) => void) => {
  const f = code().split('/').slice(0, 8);
  edit(f);
  const body = f.join('/');
  return `${body}/${checksum(body)}`;
};

describe('the checksum', () => {
  it('is CRC-32', () => expect(checksum('123456789')).toBe('cbf43926'));
});

describe('encode and decode', () => {
  it('round-trips a table, tolerating pasted whitespace and a lowercase prefix', () => {
    expect(code().startsWith('TBL1/')).toBe(true);
    expect(decodeListingCode(code())).toEqual({ ok: true, table: TABLE });
    expect(decodeListingCode(`  ${code().replace('/', '/\n')} \n`)).toEqual({ ok: true, table: TABLE });
    expect(decodeListingCode(code().replace('TBL1', 'tbl1'))).toEqual({ ok: true, table: TABLE });
  });
  it('has no code for a delivery it cannot carry', () => {
    expect(encodeListingCode({ ...TABLE, terms: { ...TABLE.terms, delivery: { type: 'pickup_local' } } })).toBeNull();
  });
});

describe('refusing a code that cannot be used', () => {
  it('refuses empty, unrelated and truncated text as malformed', () => {
    for (const text of ['', 'hello', 'TBL1', code().slice(0, 30), `${code()}/extra`, code().split('/').slice(0, 8).join('/')]) {
      const r = decodeListingCode(text);
      expect(r.ok, text).toBe(false);
    }
    expect(decodeListingCode('hello')).toEqual({ ok: false, why: 'malformed' });
  });
  it('refuses a changed character as a bad checksum', () => {
    expect(decodeListingCode(code().replace('monitor', 'monitoR'))).toEqual({ ok: false, why: 'checksum' });
    expect(decodeListingCode(code().replace('/12050/', '/12051/'))).toEqual({ ok: false, why: 'checksum' });
    const sum = code().slice(-8);
    expect(decodeListingCode(code().slice(0, -8) + (sum[0] === '0' ? '1' : '0') + sum.slice(1))).toEqual({ ok: false, why: 'checksum' });
  });
  it('refuses another version, even with a right checksum', () => {
    expect(decodeListingCode(resealed((f) => { f[0] = 'TBL2'; }))).toEqual({ ok: false, why: 'version' });
  });
  it('refuses fields that pass the checksum but are not valid terms', () => {
    const bad: Array<[number, string]> = [[1, 'not-a-ulid'], [2, 'two words'], [3, '0'], [3, '1001'], [4, '0'], [4, '1.5'], [5, 'XXX'], [7, 'gadgets']];
    for (const [i, value] of bad) {
      expect(decodeListingCode(resealed((f) => { f[i] = value; })), `${i}=${value}`).toEqual({ ok: false, why: 'malformed' });
    }
    expect(decodeListingCode(resealed((f) => { f[6] = 'ship'; }))).toEqual({ ok: false, why: 'unsupported' });
  });
  it('says each failure in its own plain words, without internals', () => {
    const said = (['malformed', 'checksum', 'version', 'unsupported'] as const).map(codeProblem);
    expect(new Set(said).size).toBe(4);
    expect(said).toContain(APPROVAL_TABLE.codeBadSum);
    for (const s of said) expect(s).not.toMatch(/checksum|ulid|deal_join|crc/i);
  });
});

describe('joining from a code', () => {
  it('builds deal_join with the seller’s deal id and exactly the decoded terms, as a buyer haggle', () => {
    const rules = { payload: { id: '01JDBUYRULES0000000000000A', version: 3 } } as unknown as MandateListEntry;
    expect(codeJoinArgs(TABLE, 'kp_seller', rules)).toEqual({
      deal_id: TABLE.dealId,
      create: { kind: 'haggle', side: 'buyer', counterparty: 'kp_seller', mandate_id: rules.payload.id, mandate_version: 3, terms: TABLE.terms, category: 'parts' },
    });
  });
});
