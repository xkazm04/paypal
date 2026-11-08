// The chat starts every flow with the step name 'start' (a chip, a slash command, typed words). Rules and
// Settings have no step called 'start': they must open on their first question, not on an empty card.
import { beforeEach, describe, expect, it } from 'vitest';
import { flowState, resetFlows, startFlow } from './store';

describe('startFlow entry step', () => {
  beforeEach(() => resetFlows());
  it('maps start to the first question of Rules and Settings', () => {
    startFlow('rules', 'start');
    expect(flowState().turns.at(-1)?.step).toBe('perDeal');
    startFlow('settings', 'start');
    expect(flowState().turns.at(-1)?.step).toBe('topic');
  });
  it('leaves start alone for flows that own it, and any explicit step', () => {
    startFlow('connections', 'start');
    expect(flowState().turns.at(-1)?.step).toBe('start');
    startFlow('rewind', 'start');
    expect(flowState().turns.at(-1)?.step).toBe('start');
    startFlow('rules', 'ends');
    expect(flowState().turns.at(-1)?.step).toBe('ends');
  });
});
