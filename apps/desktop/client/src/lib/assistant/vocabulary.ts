// The registry: the one place the assistant's vocabulary is described to humans, to the validator and
// to the emitter's prompt. STUB (WP2 owns this file): final signatures, minimal bodies.
import { PANEL_KINDS } from './contract';

/** JSON Schema of an AssistantReply, derived from the registry (passed to the CLI as --json-schema). */
export function replyJsonSchema(): Record<string, unknown> {
  return { type: 'object', properties: { v: { const: 1 }, say: { type: 'string' }, ops: { type: 'array' } }, required: ['v', 'say', 'ops'] };
}

/** Plain-text description of every panel kind, op and action, derived from the registry (for the prompt). */
export function describeVocabulary(): string {
  return PANEL_KINDS.join(', ');
}
