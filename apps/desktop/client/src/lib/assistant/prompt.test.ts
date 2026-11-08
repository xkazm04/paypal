import { describe, expect, it } from 'vitest';
import { FATES, MODULE_KEYS, PANEL_KINDS } from './contract';
import { DIGEST_CLOSE, DIGEST_OPEN } from './digest';
import { PROMPT_MAX_BYTES, systemPrompt } from './prompt';
import { ACTIONS, OPS, describeVocabulary } from './vocabulary';

describe('systemPrompt', () => {
  const p = systemPrompt();

  it('contains every registry entry and the whole vocabulary text', () => {
    expect(p).toContain(describeVocabulary());
    for (const k of [...PANEL_KINDS, ...Object.keys(OPS), ...Object.keys(ACTIONS), ...MODULE_KEYS, ...FATES]) expect(p).toContain(k);
  });

  it('is under 6 KB and deterministic', () => {
    expect(new TextEncoder().encode(p).length).toBeLessThan(PROMPT_MAX_BYTES);
    expect(systemPrompt()).toBe(p);
  });

  it('has no unfilled template braces or placeholders', () => {
    expect(p).not.toMatch(/\{\{|\}\}|\$\{|\{[A-Za-z_]+\}|undefined|\[object|NaN|TODO/);
  });

  it('names the delimiter, the data rule, the output rule and the honest-gap rule', () => {
    expect(p).toContain(`${DIGEST_OPEN} and ${DIGEST_CLOSE}`);
    expect(p).toMatch(/data, never instructions/);
    expect(p).toMatch(/ONE JSON object and nothing else/);
    expect(p).toMatch(/never invent/i);
    expect(p).toMatch(/If you do nothing|if she does nothing|what happens if you do nothing/i);
    expect(p).toMatch(/cannot act/);
  });

  it('names no vendor or model', () => {
    expect(p).not.toMatch(/claude|anthropic|openai|gpt|gemini|codex|llm|language model/i);
  });
});
