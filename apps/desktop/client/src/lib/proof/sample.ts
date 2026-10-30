// The practice deals' signed proof files, as the browser preview hands them out. Loaded on demand.
import busy from './sample/busy.tableproof?raw';
import golden from './sample/golden.tableproof?raw';
import { BUSY_DEAL_ID, SAMPLE_DEAL_ID } from './sampleId';

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
export const SAMPLES: readonly SampleFile[] = [SAMPLE_PROOF, BUSY_PROOF];
