// proof.html opens one of Break The Table's recorded deal files by name (`?file=arena-<attack id>`) and
// checks it on arrival; a name that is not one of those files is ignored, never read as a path.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARENA_BUNDLE_IDS } from '../lib/proof/arenaBundles';
import { ARENA_PROOF } from '../lib/words/arena';
import { ATTACK_WORDS } from '../arena/model';
import { arrival, ProofPage } from './ProofPage';

vi.setConfig({ testTimeout: 60_000 });
afterEach(() => { cleanup(); history.replaceState(null, '', '/'); document.documentElement.classList.remove('calm'); });

describe('proof.html?file=', () => {
  it('names only a recorded arena file', () => {
    const id = ARENA_BUNDLE_IDS[0]!;
    expect(arrival(`?file=arena-${id}`)).toMatchObject({ file: id, autoRun: true });
    for (const bad of ['?file=arena-nope', '?file=../sample/golden', '?file=d-0205', '?file=arena-' + id + '/x', '']) expect(arrival(bad).file, bad).toBeNull();
    expect(arrival('').autoRun).toBe(false);
  });

  it('opens the named file and checks it on arrival', async () => {
    document.documentElement.classList.add('calm');
    const id = 'past-the-limit';
    expect(ARENA_BUNDLE_IDS).toContain(id);
    history.replaceState(null, '', `/proof.html?file=arena-${id}`);
    render(<ProofPage />);
    await screen.findAllByText('Every check that applies passed', undefined, { timeout: 30_000 });
    expect(screen.getAllByText(new RegExp(`arena-${id}\.tableproof`)).length + screen.queryAllByText(ARENA_PROOF.label(ATTACK_WORDS[id]!.title)).length).toBeGreaterThan(0);
  });
});
