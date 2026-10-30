// @vitest-environment node
// A browser that cannot check Ed25519 (an old one) must say so on the lines that need a signature, and never
// pass them: a check that was not made is not a pass.
import { afterEach, describe, expect, it, vi } from 'vitest';
import golden from './sample/golden.tableproof?raw';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('a browser without Ed25519', () => {
  it('reads every signature line as not checked, and the file as not verified', { timeout: 60_000 }, async () => {
    const real = globalThis.crypto.subtle;
    vi.stubGlobal('crypto', { subtle: { digest: real.digest.bind(real), importKey: () => Promise.reject(new Error('no Ed25519 here')), verify: () => Promise.reject(new Error('no')) } });
    vi.resetModules();
    const { checkProofText } = await import('./verify');
    const outcome = await checkProofText(golden, null);
    if (!('report' in outcome)) throw new Error(outcome.refused);
    const by = Object.fromEntries(outcome.report.checks.map((c) => [c.id, c]));
    for (const id of ['mandate', 'transcript', 'countersign', 'evidence']) {
      expect(by[id], id).toMatchObject({ ok: false, checked: false, applies: true, detail: 'not checked: this browser cannot check Ed25519 signatures' });
    }
    // what needs no signature is still checked
    for (const id of ['format', 'audit', 'receipt', 'paypal_order']) expect(by[id]?.ok, id).toBe(true);
    expect(outcome.report.verified).toBe(false);
  });
});
