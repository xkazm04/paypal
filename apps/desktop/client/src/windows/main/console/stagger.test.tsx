// The staggered reveal (polish A): waves in order, priority inside a wave, a long wave split over
// frames, cancellation (no update after the layer left, a new layer cancels the old one's waves),
// calm motion and the test switch mount everything in the first frame, a part mounted after the
// opening shows at once. Then on the real window: every module's first wave carries its "Your
// call" and its action, and a later wave's reads wait for their turn.
import { useEffect, useState, type ReactNode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deal } from '@bindings/Deal';
import type { Module } from '@bindings/Module';
import { isTerminal } from '../logic';
import { OPENING_MS, Reveal, Skeleton, Stagger, StaggerProvider, setStaggerClock, staggerIsOff, staggerOff, staggerOn, useRevealed } from './stagger';
import { manualClock, type ManualClock } from './testing/manualClock';
import { renderLayerAtScale, settle } from './testing/scaleSmoke';

vi.mock('../../../lib/runtime', async () => (await import('./testing/runtime')).runtimeMock);

let c: ManualClock;
let log: string[];
beforeEach(() => { staggerOn(); c = manualClock(); log = []; });
afterEach(() => { cleanup(); staggerOff(); setStaggerClock(null); document.documentElement.classList.remove('calm'); vi.restoreAllMocks(); history.replaceState(null, '', '/'); });

function Part({ name }: { name: string }) {
  useEffect(() => { log.push(name); }, [name]);
  return <p data-part={name}>{name}</p>;
}

function Layer({ children }: { children?: ReactNode }) {
  return (
    <Stagger clock={c.clock}>
      <h1>The answer</h1>
      <Reveal wave={3}><Part name="explain" /></Reveal>
      <Reveal wave={2}><Part name="latest" /></Reveal>
      <Reveal wave={1} skeleton={<Skeleton className="cards" blocks={4} />}><Part name="cards" /></Reveal>
      <Reveal wave={2} priority={5}><Part name="list" /></Reveal>
      {children}
    </Stagger>
  );
}

const parts = () => Array.from(document.querySelectorAll('[data-part]')).map((e) => e.getAttribute('data-part'));

describe('the scheduler', () => {
  it('the tests run with every wave at once by default (the switch)', () => {
    staggerOff();
    expect(staggerIsOff()).toBe(true);
    render(<Layer />);
    expect(parts().sort()).toEqual(['cards', 'explain', 'latest', 'list']);
    expect(document.querySelector('[data-stg="in"]')).toBeNull();
  });

  it('wave 0 first, then the waves in order, higher priority first inside a wave', async () => {
    render(<Layer />);
    expect(screen.getByRole('heading', { name: 'The answer' })).toBeTruthy();
    expect(parts()).toEqual([]);
    expect(document.querySelector('.stg-skel.cards')?.querySelectorAll('.stg-b')).toHaveLength(4);
    await c.advance(16);
    expect(parts()).toEqual([]); // the first frame paints wave 0 alone
    await c.advance(16);
    expect(log).toEqual(['cards']);
    expect(document.querySelector('.stg-skel')).toBeNull();
    await c.flush();
    expect(log).toEqual(['cards', 'list', 'latest', 'explain']);
    expect(c.marks).toEqual(['layer:wave0', 'layer:wave1', 'layer:wave2', 'layer:wave3']);
    // a part that waited fades in; nothing was "in" before its turn
    expect(document.querySelector('[data-part="cards"]')?.closest('[data-stg]')?.getAttribute('data-stg')).toBe('in');
  });

  it('a wave with more work than a slot goes on in the next frame', async () => {
    c.work(7); // every clock read costs 7 ms: two parts fill a 12 ms slot
    render(
      <Stagger clock={c.clock}>
        {['a', 'b', 'c', 'd', 'e'].map((n) => <Reveal key={n} wave={1}><Part name={n} /></Reveal>)}
      </Stagger>,
    );
    await c.advance(32);
    expect(log).toEqual(['a', 'b']);
    await c.advance(16);
    expect(log).toEqual(['a', 'b', 'c', 'd']);
    await c.flush();
    expect(log).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('leaving the layer cancels what is pending: nothing shows, nothing updates after unmount', async () => {
    const err = vi.spyOn(console, 'error');
    const r = render(<Layer />);
    await c.advance(32);
    expect(log).toEqual(['cards']);
    r.unmount();
    await c.flush();
    expect(log).toEqual(['cards']);
    expect(err).not.toHaveBeenCalled();
  });

  it('a layer opened while another one’s waves are pending cancels those', async () => {
    const other = manualClock();
    function Two() {
      const [second, setSecond] = useState(false);
      useEffect(() => { open = () => setSecond(true); }, []);
      return (
        <StaggerProvider>
          <Stagger clock={c.clock}><Reveal wave={2}><Part name="old" /></Reveal></Stagger>
          {second ? <Stagger clock={other.clock}><Reveal wave={2}><Part name="new" /></Reveal></Stagger> : null}
        </StaggerProvider>
      );
    }
    let open = () => {};
    render(<Two />);
    act(() => open());
    await c.flush();
    await other.flush();
    expect(log).toEqual(['new']);
  });

  it('calm motion (the in-app switch) mounts every wave in the first frame, with no fade', () => {
    document.documentElement.classList.add('calm');
    render(<Layer />);
    expect(parts().sort()).toEqual(['cards', 'explain', 'latest', 'list']);
    expect(document.querySelector('[data-stg="in"]')).toBeNull();
    expect(c.pending()).toBe(1); // only the opening window's timer: no frame is waited for
  });

  it('the computer asking for reduced motion does the same', () => {
    const had = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: (q: string) => ({ matches: q.includes('reduce'), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) });
    try {
      render(<Layer />);
      expect(parts().sort()).toEqual(['cards', 'explain', 'latest', 'list']);
    } finally {
      if (had) Object.defineProperty(window, 'matchMedia', had); else Reflect.deleteProperty(window, 'matchMedia');
    }
  });

  it('calm turned on mid-sequence shows the rest at once', async () => {
    const { setCalm } = await import('../../../design/motion');
    render(<Layer />);
    await c.advance(32);
    expect(log).toEqual(['cards']);
    act(() => setCalm(true));
    expect(parts().sort()).toEqual(['cards', 'explain', 'latest', 'list']);
    act(() => setCalm(false));
  });

  it('a part that mounts during the opening takes its turn; after it, it shows at once', async () => {
    let show = (_: boolean) => {};
    function Late() {
      const [on, setOn] = useState(false);
      useEffect(() => { show = setOn; }, []);
      return on ? <Reveal wave={2} skeleton={<Skeleton className="late" />}><Part name="late" /></Reveal> : null;
    }
    render(<Layer><Late /></Layer>);
    await c.advance(64);
    act(() => show(true));
    expect(document.querySelector('.stg-skel.late')).not.toBeNull(); // still opening: it waits
    await c.flush();
    expect(parts()).toContain('late');
    act(() => show(false));
    act(() => show(true));
    expect(document.querySelector('.stg-skel.late')).toBeNull(); // settled: at once
    expect(parts()).toContain('late');
    expect(OPENING_MS).toBeGreaterThan(450);
  });

  it('useRevealed: open outside a Stagger', () => {
    function Probe() { return <p>{useRevealed(3) ? 'open' : 'waiting'}</p>; }
    render(<Probe />);
    expect(screen.getByText('open')).toBeTruthy();
  });
});

// ---- on the real window ------------------------------------------------------------------------
const MODULES: readonly Module[] = ['tables', 'spend', 'counter', 'book', 'shield', 'rescue'];

describe('the first wave on every module carries its decision (both worlds)', () => {
  it.each(MODULES.flatMap((m) => (['small', 'large'] as const).map((s) => [m, s] as const)))('%s, %s', async (m, scale) => {
    setStaggerClock(c.clock);
    const r = await renderLayerAtScale({ level: 'module', module: m }, scale);
    const at0 = {
      cards: r.layer.querySelectorAll('.ml-cards:not(.stg-skel)').length,
      call: r.layer.querySelectorAll('.ml-call').length,
      gold: Array.from(r.layer.querySelectorAll('.ui-btn.gold')).map((b) => b.textContent),
      actions: r.layer.querySelectorAll('.ml-action .ui-btn').length,
      reads: new Map([...r.budget.byCommand.entries()].map(([k, v]) => [k, v.total])),
    };
    expect(at0.cards, 'the cards wait for wave 1').toBe(0);
    await c.flush();
    await settle();
    const after = {
      call: r.layer.querySelectorAll('.ml-call').length,
      gold: Array.from(r.layer.querySelectorAll('.ui-btn.gold')).map((b) => b.textContent),
      actions: r.layer.querySelectorAll('.ml-action .ui-btn').length,
      needs: r.layer.querySelectorAll('.ml-cards .ui-sumcard.needs').length,
    };
    expect(r.layer.querySelectorAll('.ml-cards:not(.stg-skel)').length).toBe(1);
    expect(after.call, 'Your call was there in wave 0').toBe(at0.call);
    expect(after.actions, 'the action was there in wave 0').toBe(at0.actions);
    expect(at0.gold, 'every gold action was there in wave 0').toEqual(after.gold);
    // A module whose decisions wait says so in wave 0 (the Book only reads: its waiting card is an
    // outlook, its decisions are the other modules').
    if (after.needs && m !== 'book') expect(at0.call, 'a module with a needs-you card says Your call at once').toBe(1);
    // A summary reads what its answer and cards need; the later waves read nothing new.
    for (const [k, v] of r.budget.byCommand) expect(v.total, `${k} read in wave 0`).toBe(at0.reads.get(k) ?? 0);
    expect(r.errors).toEqual([]);
  }, 60_000);
});

describe('a later wave’s reads wait for their turn', () => {
  it('an ended deal reads what it showed the owner only in the last wave', async () => {
    setStaggerClock(c.clock);
    const r = await renderLayerAtScale(async (w) => {
      const deals = (await w.invoke('list_deals', null)) as Deal[];
      const d = deals.find((x) => isTerminal(x) && x.side === 'buyer') ?? deals.find((x) => isTerminal(x));
      if (!d) throw new Error('no ended deal in the world');
      return { level: 'deal', deal: d.id };
    }, 'small');
    expect(r.budget.byCommand.get('deal_history')?.total ?? 0, 'not read in waves 0-2').toBe(0);
    const before = r.budget.total;
    await c.flush();
    await settle();
    expect(r.budget.byCommand.get('deal_history')?.total ?? 0, 'read once its wave came').toBe(1);
    expect(r.budget.total).toBeGreaterThan(before);
  }, 60_000);
});
