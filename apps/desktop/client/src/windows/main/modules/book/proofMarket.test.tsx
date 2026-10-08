// market-data-2 in "Check a proof file": the market line reads in plain words; each of its
// "not checked" reasons (no market price, an older record, not agreed yet) is said as such and
// never as a pass; a forged record fails by its own line.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProofCheckLine } from '@bindings/ProofCheckLine';
import type { ProofReport } from '@bindings/ProofReport';
import { PROOF_CHECKS, PROOF_FILE_SHOWS, PROOF_NOT_APPLICABLE, proofMarketNotChecked } from '../../../../lib/words';
import { ProofReportView } from './ProofCheck';

const pass = (id: string, detail = `${id} holds`): ProofCheckLine => ({ id, ok: true, checked: true, applies: true, detail });
const absent = (id: string, detail: string): ProofCheckLine => ({ id, ok: false, checked: false, applies: false, detail });
const report = (checks: ProofCheckLine[], extra: Partial<ProofReport> = {}): ProofReport => ({
  deal_id: '01JD0000000000000000000000' as ProofReport['deal_id'], mode: 'sandbox', owner_key_id: 'b'.repeat(64),
  verified: true, checks, authority_manifest: 'a'.repeat(64), same_version: true, ...extra,
});

describe('proof file market line', () => {
  afterEach(cleanup);

  it('has plain words, a "not checked" reason and a line in what a saved file shows', () => {
    expect(PROOF_CHECKS.market).toBeTruthy();
    expect(PROOF_NOT_APPLICABLE.market).toMatch(/^Not checked: /);
    expect(PROOF_FILE_SHOWS.some((l) => /market prices/.test(l))).toBe(true);
    const text = [PROOF_CHECKS.market, PROOF_NOT_APPLICABLE.market, proofMarketNotChecked('older market record'), proofMarketNotChecked('not agreed yet')].join(' ');
    expect(text).not.toMatch(/\b(hash|digest|certificate|comparable|quartile|audit|mandate|v2|Rust)\b/i);
  });

  it('a passed line shows the percentile the checker worked out', () => {
    const r = render(<ProofReportView report={report([pass('format'), pass('market', '329.00 USD is the 62nd percentile of 13 market prices for product lg-27uk850-w')])} own={null} />);
    expect(r.container.textContent).toContain(PROOF_CHECKS.market);
    expect(r.container.textContent).toContain('62nd percentile of 13 market prices');
    expect(r.container.textContent).toContain('Every check passed');
  });

  it('each "not checked" reason is told apart and makes no claim', () => {
    const cases: [string, string][] = [
      ['not checked: the deal had no market price when it was agreed', PROOF_NOT_APPLICABLE.market!],
      ['not checked: the deal was agreed on an older market record, which kept no prices to compute again', proofMarketNotChecked('older market record')],
      ['not checked: the deal is not agreed yet', proofMarketNotChecked('not agreed yet')],
    ];
    for (const [detail, words] of cases) {
      const r = render(<ProofReportView report={report([pass('format'), absent('market', detail)])} own={null} />);
      expect(r.container.textContent).toContain(words);
      expect(r.container.textContent).not.toContain('Every check passed');
      expect(r.getAllByLabelText('not checked')).toHaveLength(1);
      cleanup();
    }
    expect(new Set(cases.map(([, w]) => w)).size).toBe(3);
  });

  it('a forged market record fails by its own line', () => {
    const r = render(<ProofReportView report={report([pass('format'), { id: 'market', ok: false, checked: true, applies: true, detail: 'the deal’s latest market record is not the one its rows recorded' }], { verified: false })} own={null} />);
    expect(r.container.textContent).toContain('Some checks did not pass');
    expect(r.getByLabelText('did not pass').parentElement?.textContent).toContain(PROOF_CHECKS.market);
  });
});
