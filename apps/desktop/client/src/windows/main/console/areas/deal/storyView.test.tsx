// The conversation's bubbles carry an aria-label, which replaces what is inside them for a screen
// reader: it must still say when a counterparty's signature could not be checked, or an unchecked
// message reads exactly like a checked one.
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptStep } from '@bindings/TranscriptStep';
import type { Backend } from '../../../../../lib/contract';
import { DEAL_STORY } from '../../../../../lib/words';
import { mockBackend, resetMockState } from '../../../../../mock/backend';
import { buildMockState } from '../../../../../mock/fixtures';
import { WorldProvider } from '../../../world';
import { StoryView } from './StoryView';

const hoisted = vi.hoisted(() => ({ current: null as Backend | null }));
vi.mock('../../../../../lib/runtime', () => ({ backend: () => hoisted.current }));

const world = buildMockState(1_800_000_000);
const haggle = world.deals.find((d) => d.display.label === 'D-0193')!;

describe('the conversation, read aloud', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); resetMockState(); hoisted.current = mockBackend('main'); });
  afterEach(() => { cleanup(); hoisted.current = null; });

  it('an unchecked signature is part of the bubble’s name; a checked one is not flagged', () => {
    const steps: TranscriptStep[] = haggle.transcript.map((s, i) => ({ ...s, verified: i !== 0 }));
    const { container } = render(
      <WorldProvider><StoryView deal={haggle.deal} steps={steps} error={null} clauses={[]} theirName="Dan · north-desk" facts={[]} factsTitle="" title="Monitor" /></WorldProvider>,
    );
    const names = [...container.querySelectorAll('.dv-chat .bub')].map((b) => b.getAttribute('aria-label') ?? '');
    expect(names).toHaveLength(steps.length);
    const first = steps.reduce((a, s) => (s.seq < a.seq ? s : a));
    const idx = [...steps].sort((a, b) => a.seq - b.seq).indexOf(first);
    expect(names[idx]).toContain(DEAL_STORY.uncheckedTitle);
    expect(names.filter((n) => n.includes(DEAL_STORY.uncheckedTitle))).toHaveLength(1);
  });
});
