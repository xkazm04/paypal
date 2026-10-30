// The house seller's signed record, as a proof file carries it: the release pin (public data that names
// the house's keys), and the signed heads of the house's own record that the wallet kept beside the deal's
// receipt and after it. The check is that every head is signed by the pinned house key, that the record
// never got shorter or was rewritten after the receipt, and that two heads at one length agree.
import { type Bytes, byteArray, same } from './bytes';
import { canonicalBytes } from './jcs';
import { isPublicKey, verifyStrict } from './ed25519';
import { bytes as byteField, flag, list, maybe, rec, text, whole } from './read';
import { Why } from './why';

export const HEAD_DOMAIN = 'table.house.head.v1';
export const PREFIX_DOMAIN = 'table.house.prefix.v1';

export interface Release {
  owner_key: Bytes;
  agent_key: Bytes;
  mandate_commitment: Bytes;
  owner_signature: Bytes;
}
export interface Head {
  epoch: Bytes;
  epoch_started: number;
  row_count: number;
  audit_head: Bytes;
  at: number;
  json: unknown;
}
export interface SignedHead {
  head: Head;
  signature: Bytes;
}
export interface Prefix {
  epoch: Bytes;
  row_count: number;
  audit_head: Bytes;
  within: number;
  at: number;
  json: unknown;
}
export interface SignedPrefix {
  prefix: Prefix;
  signature: Bytes;
}
export interface KeptHead {
  receipt: boolean;
  head: SignedHead;
  prefix: SignedPrefix | null;
  kept_at: number;
}
export interface House {
  release: Release;
  heads: KeptHead[];
}

const readHead = (value: unknown): Head => {
  const r = rec(value, ['epoch', 'epoch_started', 'row_count', 'audit_head', 'at']);
  return { epoch: byteField(r.epoch, 32), epoch_started: whole(r.epoch_started), row_count: whole(r.row_count, 0), audit_head: byteField(r.audit_head, 32), at: whole(r.at), json: value };
};
const readPrefix = (value: unknown): Prefix => {
  const r = rec(value, ['epoch', 'row_count', 'audit_head', 'within', 'at']);
  return { epoch: byteField(r.epoch, 32), row_count: whole(r.row_count, 0), audit_head: byteField(r.audit_head, 32), within: whole(r.within, 0), at: whole(r.at), json: value };
};

/** The house record a proof file carries; throws `Refused` when it is not one. */
export function readHouse(value: unknown): House {
  const r = rec(value, ['release', 'heads']);
  const rel = rec(r.release, ['owner_key', 'agent_key', 'payee', 'mandate_commitment', 'owner_signature']);
  text(rel.payee);
  return {
    release: {
      owner_key: byteField(rel.owner_key, 32),
      agent_key: byteField(rel.agent_key, 32),
      mandate_commitment: byteField(rel.mandate_commitment, 32),
      owner_signature: byteField(rel.owner_signature),
    },
    heads: list(r.heads).map((h) => {
      const x = rec(h, ['receipt', 'head', 'kept_at'], ['prefix']);
      const signed = rec(x.head, ['head', 'signature']);
      return {
        receipt: flag(x.receipt),
        head: { head: readHead(signed.head), signature: byteField(signed.signature) },
        prefix: maybe(x.prefix, (p) => {
          const s = rec(p, ['prefix', 'signature']);
          return { prefix: readPrefix(s.prefix), signature: byteField(s.signature) };
        }),
        kept_at: whole(x.kept_at),
      };
    }),
  };
}

/** `HouseRelease::verify`: the pin names two different keys, and the owner signed its mandate commitment. */
export async function releaseHolds(r: Release): Promise<boolean> {
  if (same(r.owner_key, r.agent_key) || !isPublicKey(r.agent_key) || !isPublicKey(r.owner_key)) return false;
  return verifyStrict(r.owner_key, r.mandate_commitment, r.owner_signature);
}
/** `SignedHouseHead::verify`: the pin, then the head's own signature by the pinned agent key. */
export async function headSigned(h: SignedHead, r: Release): Promise<boolean> {
  if (!(await releaseHolds(r))) return false;
  if (h.head.row_count === 0 || h.head.at < h.head.epoch_started) return false;
  return verifyStrict(r.agent_key, canonicalBytes([HEAD_DOMAIN, h.head.json]), h.signature);
}
export async function prefixSigned(p: SignedPrefix, r: Release): Promise<boolean> {
  if (!(await releaseHolds(r))) return false;
  if (p.prefix.row_count === 0 || p.prefix.row_count > p.prefix.within) return false;
  return verifyStrict(r.agent_key, canonicalBytes([PREFIX_DOMAIN, p.prefix.json]), p.signature);
}

export type HeadVerdict = 'same' | 'extends' | 'longer' | 'new_epoch' | 'shorter' | 'rewritten';
/** How a later head relates to one kept earlier (signatures are checked by the caller). */
export function compareHeads(kept: Head, later: Head, prefix: Prefix | null): HeadVerdict {
  if (!same(later.epoch, kept.epoch)) return 'new_epoch';
  if (later.row_count < kept.row_count) return 'shorter';
  if (later.row_count === kept.row_count) return same(later.audit_head, kept.audit_head) ? 'same' : 'rewritten';
  if (prefix && same(prefix.epoch, kept.epoch) && prefix.row_count === kept.row_count && prefix.within === later.row_count) {
    return same(prefix.audit_head, kept.audit_head) ? 'extends' : 'rewritten';
  }
  return 'longer';
}
/** A signed prefix that contradicts a kept head: same epoch and row count, a different hash. */
export const prefixContradicts = (kept: Head, p: Prefix): boolean =>
  same(p.epoch, kept.epoch) && p.row_count === kept.row_count && !same(p.audit_head, kept.audit_head);

/** Heads seen over time: each signed, and within one record the count never falls and one count has one
 *  hash. A new record (epoch) is reported, not hidden. */
export async function headsConsistent(heads: SignedHead[], release: Release): Promise<string> {
  const sorted = [...heads].sort((a, b) => a.head.at - b.head.at || a.head.row_count - b.head.row_count);
  const epochs: Bytes[] = [];
  for (const [i, h] of sorted.entries()) {
    if (!(await headSigned(h, release))) throw new Why(`head ${i + 1} is not signed by the pinned house key`);
    if (!epochs.some((e) => same(e, h.head.epoch))) epochs.push(h.head.epoch);
    for (const earlier of sorted.slice(0, i)) {
      const [a, b] = [earlier.head, h.head];
      if (!same(a.epoch, b.epoch)) continue;
      if (b.row_count < a.row_count && b.at > a.at) throw new Why(`the record got shorter: ${a.row_count} entries at ${a.at}, then ${b.row_count} at ${b.at}`);
      if (b.row_count === a.row_count && !same(b.audit_head, a.audit_head)) throw new Why(`two different records signed at ${a.row_count} entries`);
    }
  }
  if (epochs.length === 0) return 'no heads to compare';
  if (epochs.length === 1) return `${sorted.length} head(s), never shorter, one record`;
  return `${sorted.length} head(s), never shorter within a record; the house started ${epochs.length - 1} new record(s)`;
}

export const isHash = (v: unknown): boolean => byteArray(v, 32) !== null;
