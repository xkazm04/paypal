// The three practice deals the Rust suite builds (table_client::sample_proof): the parity oracles of
// the browser checker. Each comes with tampered copies whose reports the checker must reproduce
// (parity.test.ts), and the checker's own tests break them. The preview shows none of them to a
// person: what it shows are the recorded samples (sample.ts), files the wallet exported from real
// recorder runs. Tests only.
import busy from './sample/busy.tableproof?raw';
import buyer from './sample/buyer.tableproof?raw';
import golden from './sample/golden.tableproof?raw';
import { BUSY_DEAL_ID, GOLDEN_DEAL_ID as SAMPLE_DEAL_ID } from './sampleId';

export interface SampleFile {
  name: string;
  text: string;
  sample: true;
  /** A few words naming the deal in the picker. */
  label: string;
  /** What happened in it, in a sentence. */
  story: string;
}
export const SAMPLE_PROOF: SampleFile = {
  name: `${SAMPLE_DEAL_ID}.tableproof`,
  text: golden,
  sample: true,
  label: 'The monitor sale',
  story: 'Maya’s shop sold a refurbished monitor: asked $249.00, haggled down to $212.00, and Maya approved the order and then the capture.',
};
export const BUSY_PROOF: SampleFile = {
  name: `${BUSY_DEAL_ID}.tableproof`,
  text: busy,
  sample: true,
  label: 'A busier deal',
  story: 'Another monitor sale, with everything the first one lacks: one of two tables in a shop-around, held by the safety check until Maya released it, priced against the market, and a capture whose answer was lost and read back.',
};
export const BUYER_PROOF: SampleFile = {
  name: `buyer-${SAMPLE_DEAL_ID}.tableproof`,
  text: buyer,
  sample: true,
  label: 'The same sale, from the buyer’s side',
  story: 'The same monitor sale as the buyer’s wallet kept it: the same signed messages and the same receipt, but the buyer’s own owner, rules and record. The buyer’s owner accepted the shop’s last counter in their own signature.',
};
export const PRACTICE: readonly SampleFile[] = [SAMPLE_PROOF, BUYER_PROOF, BUSY_PROOF];
