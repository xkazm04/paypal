import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Mode } from '@bindings/Mode';
import { RunBadge } from '../shared/honesty';
import { modeWord, runBadge } from './words';

describe('agent run badge (T2)', () => {
  afterEach(cleanup);

  it('names a scripted-engine run "Practice agent", in the UX-GUIDE word', () => {
    expect(runBadge({ mode: 'scripted_engine' })).toBe('Practice agent');
    expect(runBadge({ mode: 'scripted_engine' })).toBe(modeWord('scripted_engine'));
  });

  it('adds no badge to other runs (the deal keeps its own mode badge)', () => {
    for (const mode of ['sandbox', 'replay'] satisfies Mode[]) expect(runBadge({ mode })).toBeNull();
  });

  it('renders the badge beside a practice run and nothing beside a sandbox run', () => {
    const practice = render(<RunBadge run={{ mode: 'scripted_engine' }} />);
    expect(practice.container.textContent).toBe('Practice agent');
    expect(practice.container.querySelector('.badge.scripted_engine')).not.toBeNull();
    cleanup();
    expect(render(<RunBadge run={{ mode: 'sandbox' }} />).container.textContent).toBe('');
  });
});
