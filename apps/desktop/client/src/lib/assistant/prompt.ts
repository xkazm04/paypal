// The system prompt of the claude-code engine, derived from vocabulary.ts (never hand-maintained
// beside it). STUB (WP2): final signature. Pure: imports nothing browser-only (the dev bridge
// imports it in Node).
import { describeVocabulary } from './vocabulary';

export function systemPrompt(): string {
  return `You choose which panels the board shows. Vocabulary: ${describeVocabulary()}`;
}
