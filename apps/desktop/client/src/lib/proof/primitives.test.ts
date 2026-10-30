// @vitest-environment node
// The checker's small parts: canonical JSON (RFC 8785), base64url, Ed25519 held to verify_strict,
// the editor's text for a file, the key fingerprint, and the sample file's own facts.
import { describe, expect, it } from 'vitest';
import { fromBase64Url, sha256, toBase64Url, toHex, utf8 } from './bytes';
import { canonical } from './jcs';
import { ed25519Works, isPublicKey, verifyStrict } from './ed25519';
import { fromView, placesIn, toFile, toView } from './fileText';
import { locate } from './locate';
import { fingerprint, WORDS } from './fingerprint';
import golden from './sample/golden.tableproof?raw';
import { SAMPLE_PROOF } from './sample';
import { SAMPLE_DEAL_ID } from './sampleId';

const hex = (text: string): Uint8Array => Uint8Array.from(text.match(/../g) ?? [], (h) => parseInt(h, 16));

describe('canonical JSON (RFC 8785)', () => {
  it('sorts keys by UTF-16 code unit and prints numbers as ECMAScript does', () => {
    // the same vector crates/table-core/src/canonical.rs pins for the Rust side
    expect(canonical({ '': 1, '\u{1f600}': 2, n: 1e-7 })).toBe('{"n":1e-7,"\u{1f600}":2,"":1}');
    expect(canonical({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(canonical([1, 'x', null, true, { z: [] }])).toBe('[1,"x",null,true,{"z":[]}]');
    expect(canonical(-0)).toBe('0');
  });
  it('refuses what is not JSON', () => {
    expect(() => canonical(Number.NaN)).toThrow();
    expect(() => canonical(undefined)).toThrow();
  });
});

describe('base64url', () => {
  it('reads only the unpadded, canonical form', () => {
    expect(toBase64Url(utf8('hello?'))).toBe('aGVsbG8_');
    expect(fromBase64Url('aGVsbG8_')).toEqual(utf8('hello?'));
    expect(fromBase64Url('aGVsbG8/')).toBeNull(); // not the url-safe alphabet
    expect(fromBase64Url('aGVsbA==')).toBeNull(); // padded
    expect(fromBase64Url('aGVsbB')).toBeNull(); // stray trailing bits
    expect(fromBase64Url('a')).toBeNull();
  });
  it('hashes with SHA-256', async () => {
    expect(toHex(await sha256(utf8('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

// RFC 8032, section 7.1, test 2: one byte, 0x72.
const KEY = hex('3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c');
const MESSAGE = hex('72');
const SIGNATURE = hex('92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00');
/** The group order, little-endian; adding it to S gives a signature the wallet's verifier refuses. */
const L = 2n ** 252n + 27742317777372353535851937790883648493n;

describe('Ed25519, as strict as the wallet’s verifier', () => {
  it('works in this runtime', async () => {
    expect(await ed25519Works()).toBe(true);
  });
  it('accepts a known signature and refuses any change to the message or the signature', async () => {
    expect(await verifyStrict(KEY, MESSAGE, SIGNATURE)).toBe(true);
    expect(await verifyStrict(KEY, hex('73'), SIGNATURE)).toBe(false);
    const flipped = Uint8Array.from(SIGNATURE);
    flipped[10] = (flipped[10] ?? 0) ^ 1;
    expect(await verifyStrict(KEY, MESSAGE, flipped)).toBe(false);
    expect(await verifyStrict(KEY, MESSAGE, SIGNATURE.subarray(0, 63))).toBe(false);
  });
  it('refuses a malleated signature (S plus the group order) that a lenient verifier would accept', async () => {
    let s = 0n;
    for (let i = 63; i >= 32; i--) s = (s << 8n) | BigInt(SIGNATURE[i] ?? 0);
    const bumped = Uint8Array.from(SIGNATURE);
    let t = s + L;
    for (let i = 32; i < 64; i++) {
      bumped[i] = Number(t & 0xffn);
      t >>= 8n;
    }
    expect(await verifyStrict(KEY, MESSAGE, bumped)).toBe(false);
  });
  it('refuses a key of small order and a point that is not on the curve', async () => {
    const identity = new Uint8Array(32);
    identity[0] = 1;
    expect(isPublicKey(identity)).toBe(true);
    expect(await verifyStrict(identity, MESSAGE, SIGNATURE)).toBe(false);
    const off = new Uint8Array(32).fill(2); // y = 0x0202…02 has no x on the curve
    expect(isPublicKey(off)).toBe(false);
    expect(isPublicKey(KEY)).toBe(true);
    expect(isPublicKey(KEY.subarray(0, 31))).toBe(false);
  });
});

describe('the editor’s text for a file', () => {
  const document: unknown = JSON.parse(golden);
  it('shows byte arrays as hex and reads them back to the same file', () => {
    const view = toView(document);
    expect(view).toContain('"hex:');
    expect(view.length).toBeLessThan(golden.length * 0.6);
    expect(fromView(view)).toEqual(document);
    expect(toFile(fromView(view))).toBe(golden);
  });
  it('leaves everything else exactly as written', () => {
    const view = toView({ minor: 21200, list: [1, 2, 3], key: [...new Uint8Array(32).fill(7)] });
    expect(view).toContain('"minor": 21200');
    expect(view).toContain('"hex:07070707');
    expect(fromView('{ "a": "hex:zz", "b": "hex:0a0b" }')).toEqual({ a: 'hex:zz', b: [10, 11] });
    expect(() => fromView('{ nope')).toThrow(SyntaxError);
  });
  it('finds the places a person would change', () => {
    const view = toView(document);
    const at = placesIn(view);
    const text = (p: keyof typeof at): string => (at[p] ? view.slice(at[p][0], at[p][1]) : '');
    expect(text('price')).toBe('21200');
    expect(text('payee')).toBe('maya-monitors');
    expect(text('paypal')).toBe('212.00');
    expect(text('line')).toMatch(/^\d{10}$/);
    expect(text('signature')).toHaveLength(8);
    // the first characters of the third message's signature, which the tamper control changes
    const raw = (document as { transcript: Array<{ raw: string }> }).transcript[2]?.raw ?? '';
    expect(raw.slice(raw.lastIndexOf('.') + 1)).toMatch(new RegExp(`^${text('signature')}`));
  });
});

describe('a key as words and colours', () => {
  it('has 256 different words, so a byte picks exactly one', () => {
    expect(WORDS).toHaveLength(256);
    expect(new Set(WORDS).size).toBe(256);
    expect(WORDS.every((w) => /^[a-z]{3,8}$/.test(w))).toBe(true);
  });
  it('reads the first bytes for the words and later ones for the colours', () => {
    const print = fingerprint('00ff10ab' + 'c0' + '01' + '1f' + '20' + '00'.repeat(23));
    expect(print?.words).toEqual([WORDS[0], WORDS[255], WORDS[16], WORDS[171]]);
    expect(print?.colours).toEqual([0, 1, 15, 0]);
    expect(fingerprint('not hex')).toBeNull();
    // two keys that differ anywhere in the first eight bytes read differently
    expect(fingerprint('11'.repeat(32))).not.toEqual(fingerprint('11'.repeat(7) + '12' + '11'.repeat(24)));
  });
});

describe('the sample file', () => {
  it('is the practice deal, and is the file the wallet writes', () => {
    expect((JSON.parse(golden) as { deal: { id: string } }).deal.id).toBe(SAMPLE_DEAL_ID);
    expect(SAMPLE_PROOF.name).toBe(`${SAMPLE_DEAL_ID}.tableproof`);
    expect(SAMPLE_PROOF.text).toBe(golden);
    // saving the file the person was shown gives back the very bytes the wallet's tests wrote
    expect(toFile(JSON.parse(golden))).toBe(golden);
  });
});

describe('where a change is in the editor’s text', () => {
  const view = toView(JSON.parse(golden));
  const at = (pointer: string): string => {
    const range = locate(view, pointer);
    return range ? view.slice(range[0], range[1]) : '';
  };
  it('finds a number, a string, and a place inside a list', () => {
    expect(at('/deal/terms/unit_price/minor')).toBe('21200');
    expect(at('/closed_mandates/0/mandate/payee')).toBe('maya-monitors');
    expect(at('/format')).toBe('table.proof.v2');
    expect(at('/audit/0/action')).toBe('deal.created');
    expect(at('/paypal_calls/3/method')).toBe('POST');
    // a whole value: the hex text of a signature
    expect(at('/evidence_sig')).toMatch(/^hex:[0-9a-f]{128}$/);
  });
  it('finds nothing where the file has nothing', () => {
    expect(locate(view, '/deal/nothing')).toBeNull();
    expect(locate(view, '/audit/9999')).toBeNull();
    expect(locate('{ not json', '/a')).toBeNull();
  });
});
