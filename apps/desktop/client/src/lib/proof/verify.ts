// "Check a proof file" with nothing installed: read the file, make the sixteen checks, and say
// what holds. The same report the wallet's own checker gives (`ProofReport`), made here in the
// browser from the file alone.
import { sha256, toHex } from './bytes';
import { type Bundle, NOT_A_PROOF, readBundle, Refused } from './bundle';
import { proofText, writtenWrong } from './text';
import { type CheckLine, CHECK_IDS, makeRun, runCheck, type Run } from './checks';
import { ed25519Works, isPublicKey } from './ed25519';
import { normalize } from './normalize';

export type { CheckLine };
export interface ProofReport {
  deal_id: string;
  mode: string;
  /** The owner key's full id (64 hex characters), or "invalid". */
  owner_key_id: string;
  verified: boolean;
  checks: CheckLine[];
  /** The permissions fingerprint the file names (hex); null in a first-format file. */
  authority_manifest: string | null;
  /** Whether that fingerprint is the checking app's own; null when the file names none. */
  same_version: boolean | null;
}
export type Outcome = { report: ProofReport } | { refused: string };

/** No real proof file comes near this; a larger one is refused before it is parsed. */
export const PROOF_FILE_LIMIT = 8 * 1024 * 1024;
export const TOO_LARGE = 'This file is far larger than any proof file, so it was not checked.';

/** A file read and ready to check, one line at a time. */
export interface Prepared {
  bundle: Bundle;
  deal_id: string;
  mode: string;
  owner_key_id: string;
  authority_manifest: string | null;
  /** Whether this browser can check Ed25519 signatures at all. */
  signatures: boolean;
  /** Make one check (any order; each is independent of the others). */
  check(id: string): Promise<CheckLine>;
  /** Make them all, in report order. */
  report(own?: string | null): Promise<ProofReport>;
}

/** The verdict: every check that applies passed. A check that does not apply is no claim; a check
 *  that applies but could not be made holds the file back. */
export const verified = (checks: readonly CheckLine[]): boolean => checks.every((c) => c.ok || !c.applies);

/** A picked file's text, read the way the wallet reads it (UTF-8 only; no byte-order mark). Null when it is not text. */
export async function readProofFile(file: Blob): Promise<string | null> {
  return proofText(await file.arrayBuffer());
}

/** Read a proof file's text. Refuses (with the wallet's own words) what is not a proof file. */
export async function prepareProof(text: string): Promise<Prepared | { refused: string }> {
  if (text.length > PROOF_FILE_LIMIT) return { refused: TOO_LARGE };
  let bundle: Bundle;
  try {
    const document: unknown = JSON.parse(text);
    if (writtenWrong(text)) return { refused: NOT_A_PROOF };
    // The wallet hashes its typed reading of the file, not the bytes: take the file through the same changes.
    normalize(document);
    bundle = readBundle(document);
  } catch (e) {
    if (e instanceof Refused || e instanceof SyntaxError || e instanceof RangeError) return { refused: NOT_A_PROOF };
    throw e;
  }
  const signatures = await ed25519Works();
  const run: Run = await makeRun(bundle, signatures);
  const owner_key_id = isPublicKey(bundle.owner_key) ? toHex(await sha256(bundle.owner_key)) : 'invalid';
  const authority_manifest = bundle.authority_manifest ? toHex(bundle.authority_manifest) : null;
  const prepared: Prepared = {
    bundle,
    deal_id: bundle.deal.id,
    mode: bundle.deal.mode,
    owner_key_id,
    authority_manifest,
    signatures,
    check: (id) => runCheck(id, run),
    async report(own = null) {
      const checks: CheckLine[] = [];
      for (const id of CHECK_IDS) checks.push(await runCheck(id, run));
      return {
        deal_id: prepared.deal_id,
        mode: prepared.mode,
        owner_key_id,
        verified: verified(checks),
        checks,
        authority_manifest,
        same_version: authority_manifest === null ? null : authority_manifest === own,
      };
    },
  };
  return prepared;
}

/** Check a proof file's text from start to finish. */
export async function checkProofText(text: string, own: string | null = null): Promise<Outcome> {
  const prepared = await prepareProof(text);
  if ('refused' in prepared) return prepared;
  return { report: await prepared.report(own) };
}
