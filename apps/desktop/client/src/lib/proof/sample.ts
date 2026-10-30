// The practice deal's signed proof file, as the browser preview hands it out. Loaded on demand.
import golden from './sample/golden.tableproof?raw';
import { SAMPLE_DEAL_ID } from './sampleId';

export const SAMPLE_PROOF = { name: `${SAMPLE_DEAL_ID}.tableproof`, text: golden, sample: true } as const;
