// "Check a proof file": the report of one checked file (the Book's proof view,
// console/areas/book/Proof.tsx, runs the check). Every value in it comes from the file, so it is
// shown as plain text and never interpreted. The owner key is shown whole (it is the anchor a
// person compares), next to whether it is this wallet's own.
import type { ProofCheckLine } from '@bindings/ProofCheckLine';
import type { ProofReport } from '@bindings/ProofReport';
import { keyMatch } from '../../../../lib/format';
import {
  fingerprintGroups, modeWord, PERMISSIONS_FINGERPRINT, PERMISSIONS_FINGERPRINT_MEANS, PROOF_ALL_THAT_APPLY, PROOF_CHECKS, PROOF_KEY_ANCHOR,
  PROOF_KEY_MATCH, PROOF_NOT_APPLICABLE, PROOF_NOT_CHECKED, PROOF_OLDER_FILE, PROOF_SOME_UNCHECKED, PROOF_VERSION_MATCH, proofMarketNotChecked,
} from '../../../../lib/words';
import { KeyId } from '../../../../shared/ownerKey';
import { Chip, Kv } from '../../../../shared/ui';

const clip = (s: string, n = 160): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Why a line reads "not checked": the file lacks a record it should have (an order record), the
 *  file is an older kind, or the deal had nothing of that kind. */
function notCheckedWords(c: ProofCheckLine, older: boolean): string {
  if (c.applies) return PROOF_NOT_CHECKED;
  if (older) return PROOF_OLDER_FILE;
  if (c.id === 'market') return proofMarketNotChecked(c.detail);
  return PROOF_NOT_APPLICABLE[c.id] ?? PROOF_OLDER_FILE;
}

/** One checked file: the verdict, the owner key whole (and whether it is `own`, this wallet's key),
 *  the permissions it was saved under, then each check. A check the file could not support, or
 *  one about something the deal never had, reads "not checked", never passed. */
export function ProofReportView({ report, own }: { report: ProofReport; own: string | null }) {
  const match = report.owner_key_id !== 'invalid' ? keyMatch(report.owner_key_id, own) : null;
  // A file with only checks that could not be made is not verified, but not shown as failed either.
  const failed = report.checks.some((c) => !c.ok && c.checked);
  // Checks about something the deal never had make no claim, so the verdict says "that apply".
  const someApply = report.checks.some((c) => !c.applies);
  const older = report.authority_manifest === null;
  return (
    <>
      <p className="pc-verdict">{report.verified ? <Chip tone="ok">{someApply ? PROOF_ALL_THAT_APPLY : 'Every check passed'}</Chip> : failed ? <Chip tone="red">Some checks did not pass</Chip> : <Chip tone="gold">{PROOF_SOME_UNCHECKED}</Chip>}</p>
      <Kv items={[
        ['Owner key', report.owner_key_id === 'invalid' ? <Chip tone="red">not a valid key</Chip> : (
          <span className="pc-key">
            <KeyId id={report.owner_key_id} />
            {match ? <span className={`pc-match ${match}`}>{match === 'mine' ? '✓ ' : ''}{PROOF_KEY_MATCH[match]}</span> : null}
          </span>
        )],
        ['Mode', modeWord(report.mode)],
        ['Deal', <span className="mono">{clip(report.deal_id, 40)}</span>],
        ...(report.authority_manifest ? [[PERMISSIONS_FINGERPRINT, (
          <span className="pc-key" title={PERMISSIONS_FINGERPRINT_MEANS}>
            <span className="mono pc-print">{fingerprintGroups(clip(report.authority_manifest, 64))}</span>
            {report.same_version !== null ? <span className={`pc-match ${report.same_version ? 'mine' : 'other'}`}>{report.same_version ? '✓ ' : ''}{PROOF_VERSION_MATCH[report.same_version ? 'same' : 'other']}</span> : null}
          </span>
        )] as const] : []),
      ]} />
      {/* Without this wallet's own key to compare, the person compares it with the owner's. */}
      {match ? null : <p className="ui-hint">{PROOF_KEY_ANCHOR}</p>}
      <ul className="pc-checks">
        {report.checks.map((c) => (
          <li key={c.id} className={c.ok ? 'ok' : c.checked ? 'bad' : 'unchecked'}>
            <span role="img" aria-label={c.ok ? 'passed' : c.checked ? 'did not pass' : 'not checked'}>{c.ok ? '✓' : c.checked ? '✗' : '–'}</span>{' '}
            {PROOF_CHECKS[c.id] ?? 'A check this wallet does not know.'}
            {c.ok || c.checked ? <div className="ui-hint mono">{clip(c.detail)}</div> : <div className="ui-hint">{notCheckedWords(c, older)}</div>}
          </li>
        ))}
      </ul>
    </>
  );
}
