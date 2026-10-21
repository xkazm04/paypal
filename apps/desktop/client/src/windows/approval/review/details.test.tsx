// The Details sheet's signed history: when it can't be read, the notice says so in plain words,
// never the wallet's own text.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ApprovalSummary } from '@bindings/ApprovalSummary';
import type { H256 } from '@bindings/H256';
import { WalletError } from '../../../lib/contract';
import { footerNoticeText } from '../model';
import { DetailsSheet } from './Details';

const HASH = Array.from({ length: 32 }, (_, i) => i) as H256;
const summary = {
  deal: {
    id: '01JDTESTDEAL0000000000000Q', kind: 'purchase', side: 'buyer', counterparty: 'kp_test',
    terms: { item_ref: 'dock', qty: 1, unit_price: { minor: 6400, currency: 'USD' }, currency: 'USD', delivery: { type: 'digital_now' } },
    state: 'AWAITING_APPROVAL', mandate_id: 'M1', mandate_version: 3, transcript_head: HASH,
    paypal: { order: null, authorization: null, capture: null, subscription: null }, mode: 'sandbox', market: null, shield: 'CLEAR',
  },
  evidence: { deal_id: 'x', receipt: 'NONE', reconciliation: 'not_applicable' },
  attempt: 1, terms_hash: HASH, locked: false, can_release: true, can_open_paypal: true, unavailable_reason: null,
  checks: [], checks_hash: HASH,
} as unknown as ApprovalSummary;

afterEach(() => cleanup());

describe('the signed history in Details', () => {
  for (const [code, message] of [['UNAVAILABLE', 'wallet actor stopped'], ['PERMISSION', 'not the selected deal'], ['INVALID', 'Invalid or stale wallet command']] as const) {
    it(`${code}: plain words, never the wallet’s text`, () => {
      const error = new WalletError({ code, message });
      render(
        <DetailsSheet title="t" onClose={() => {}} heads={['a', 'b']} rows={[]} evidence={null} status={null} mismatch={null}
          whatItDoes={null} steps={[]} countdown={null} summary={summary} transcript={undefined} transcriptError={error} />,
      );
      const text = document.body.textContent ?? '';
      expect(text).toContain('No signed history');
      expect(text).toContain(footerNoticeText('read', error));
      expect(text).not.toContain(message);
    });
  }
});
