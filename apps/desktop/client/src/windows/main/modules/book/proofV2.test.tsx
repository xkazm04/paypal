// Proof file v2 in "Check a proof file": the new lines read in plain words, a line about something
// the deal never had reads "not checked" (never passed), the verdict says "that apply", and the
// file's permissions are compared with this wallet's: same version or a different version.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProofCheckLine } from '@bindings/ProofCheckLine';
import type { ProofReport } from '@bindings/ProofReport';
import {
  PROOF_ALL_THAT_APPLY, PROOF_CHECKS, PROOF_FILE_SHOWS, PROOF_NOT_APPLICABLE, PROOF_OLDER_FILE, PROOF_VERSION_MATCH,
} from '../../../../lib/words';
import { ProofReportView } from './ProofCheck';

const PRINT = '72748e39'.repeat(8);
const V2 = ['owner_saw', 'one_request', 'group', 'shield', 'house_record', 'permissions'];
const pass = (id: string): ProofCheckLine => ({ id, ok: true, checked: true, applies: true, detail: `${id} holds` });
const absent = (id: string): ProofCheckLine => ({ id, ok: false, checked: false, applies: false, detail: `not checked: no ${id}` });
const report = (checks: ProofCheckLine[], extra: Partial<ProofReport> = {}): ProofReport => ({
  deal_id: '01JD0000000000000000000000' as ProofReport['deal_id'], mode: 'sandbox', owner_key_id: 'b'.repeat(64),
  verified: true, checks, authority_manifest: PRINT, same_version: true, ...extra,
});

describe('proof file v2 lines', () => {
  afterEach(cleanup);

  it('every new check has plain words and a "not checked" reason, with no internals', () => {
    for (const id of V2) {
      expect(PROOF_CHECKS[id]).toBeTruthy();
      expect(PROOF_NOT_APPLICABLE[id]).toMatch(/^Not checked: /);
    }
    const text = [...V2.map((id) => PROOF_CHECKS[id]), ...Object.values(PROOF_NOT_APPLICABLE), ...PROOF_FILE_SHOWS, PROOF_OLDER_FILE].join(' ');
    expect(text).not.toMatch(/\b(request id|hash|audit|mandate|manifest|HOLD|BLOCK|v2|clause|Rust)\b/);
  });

  it('a check the deal had nothing for reads "not checked" with its reason, and the verdict says "that apply"', () => {
    const r = render(<ProofReportView report={report([pass('format'), pass('owner_saw'), absent('group'), pass('permissions')])} own={null} />);
    expect(r.container.textContent).toContain(PROOF_ALL_THAT_APPLY);
    expect(r.container.textContent).not.toContain('Every check passed');
    expect(r.container.textContent).toContain(PROOF_NOT_APPLICABLE.group);
    expect(r.container.textContent).toContain(PROOF_CHECKS.owner_saw);
    expect(r.getAllByLabelText('not checked')).toHaveLength(1);
  });

  it('a failed new check reads as failed by its own words', () => {
    const r = render(<ProofReportView report={report([pass('format'), { id: 'shield', ok: false, checked: true, applies: true, detail: 'the capture step went ahead while the safety check held the deal' }], { verified: false })} own={null} />);
    expect(r.container.textContent).toContain('Some checks did not pass');
    expect(r.getByLabelText('did not pass').parentElement?.textContent).toContain(PROOF_CHECKS.shield);
  });

  it('shows the permissions fingerprint in groups and whether it is this version', () => {
    const same = render(<ProofReportView report={report([pass('permissions')])} own={null} />);
    expect(same.container.textContent).toContain('72748e39 72748e39');
    expect(same.container.textContent).toContain(PROOF_VERSION_MATCH.same);
    cleanup();
    const other = render(<ProofReportView report={report([pass('permissions')], { same_version: false })} own={null} />);
    expect(other.container.textContent).toContain(PROOF_VERSION_MATCH.other);
    expect(other.container.textContent).toContain('Every check passed');
  });

  it('an older file names no permissions and its new lines say the file is older', () => {
    const r = render(<ProofReportView report={report([pass('format'), ...V2.map(absent)], { authority_manifest: null, same_version: null })} own={null} />);
    expect(r.container.textContent).not.toContain('Permissions fingerprint');
    expect(r.getAllByText(PROOF_OLDER_FILE)).toHaveLength(V2.length);
    expect(r.container.textContent).toContain(PROOF_ALL_THAT_APPLY);
  });
});
