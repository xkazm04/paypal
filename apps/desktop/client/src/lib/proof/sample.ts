// The signed proof files the browser preview shows a person and hands out: files the wallet itself
// exported from real recorder runs, never files made up for the page. The house haggle's agreed deal
// (the preview's D-0205) is written by table-runtime's haggle recorder; the arena's refused attacks by
// the arena's recorder (crates/table-app/tests/gauntlet/arena.rs). Every one verifies, in Rust and in
// this checker (parity.test.ts against recorded.json). Loaded on demand.
import arenaAccept from './sample/arena-accept-over-her-line.tableproof?raw';
import arenaBulk from './sample/arena-fifty-monitors.tableproof?raw';
import house from './sample/d-0205.tableproof?raw';
import { RECORD } from '../../arena/record';
import { RECORDED } from '../../mock/haggle';
import { PROOF_SAMPLES } from '../words';
import type { SampleFile } from './practice';
import { RECORDED_DEAL_ID } from './sampleId';

export type { SampleFile };

const usd = (minor: number): string => `$${(minor / 100).toFixed(2)}`;
const amountOf = (decimal: unknown): number => Math.round(Number(decimal) * 100);
const bulk = RECORD.attacks.find((a) => a.id === 'fifty-monitors')?.sent as { arguments?: { amount?: string; items?: { qty?: number }[] } } | undefined;

/** The house haggle, agreed: the recording's own deal, as the wallet exported it. */
export const HOUSE_PROOF: SampleFile = {
  name: `${RECORDED_DEAL_ID}.tableproof`,
  text: house,
  sample: true,
  label: PROOF_SAMPLES.house.label,
  story: PROOF_SAMPLES.house.story(usd(RECORDED.house.steps[0]?.price ?? 0), usd(RECORDED.house.outcome.price), usd(RECORDED.house.rules.ask_above)),
};
export const ARENA_ACCEPT_PROOF: SampleFile = {
  name: 'arena-accept-over-her-line.tableproof',
  text: arenaAccept,
  sample: true,
  label: PROOF_SAMPLES.arenaAccept.label,
  story: PROOF_SAMPLES.arenaAccept.story(usd(RECORDED.dan.outcome.price), usd(RECORDED.dan.rules.ask_above)),
};
export const ARENA_BULK_PROOF: SampleFile = {
  name: 'arena-fifty-monitors.tableproof',
  text: arenaBulk,
  sample: true,
  label: PROOF_SAMPLES.arenaBulk.label,
  story: PROOF_SAMPLES.arenaBulk.story(bulk?.arguments?.items?.[0]?.qty ?? 0, usd(amountOf(bulk?.arguments?.amount)), usd(RECORDED.dan.rules.per_deal)),
};
export const SAMPLES: readonly SampleFile[] = [HOUSE_PROOF, ARENA_ACCEPT_PROOF, ARENA_BULK_PROOF];
