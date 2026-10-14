// The console's routes: every older link still parses to the same place, the new layers round-trip
// through the hash, and the chain of layers (depth 1-4, parents, the direction of a move) comes
// from the route alone.
import { describe, expect, it } from 'vitest';
import type { Module } from '@bindings/Module';
import { formatHash, parseHash, type Route } from '../logic';
import { chainOf, depthOf, directionOf, isAncestor, moduleOfRoute, parentOf, routeKey, type ChainCtx } from './route';

const ctx: ChainCtx = {
  dealModule: (d) => (d === 'D-0193' || d === '01JDEAL' ? 'tables' : null),
  knownView: (m: Module, v: string) => m === 'book' && (v === 'ledger' || v === 'ask'),
};

describe('older links still land where they did', () => {
  it.each<[string, Route, string | null]>([
    ['', { level: 'home' }, null],
    ['#m=spend', { level: 'module', module: 'spend' }, null],
    ['#m=book&v=ledger', { level: 'module', module: 'book', view: 'ledger' }, null],
    ['#d=D-0193', { level: 'deal', deal: 'D-0193' }, null],
    ['#d=01JDEAL&s=settings', { level: 'deal', deal: '01JDEAL' }, 'settings'],
    ['#s=pairing', { level: 'home' }, 'pairing'],
    ['#s=mandates', { level: 'home' }, 'mandates'],
    ['#s=setup&step=rules', { level: 'setup', step: 'rules' }, null],
    ['#s=setup', { level: 'setup', step: 'keys' }, null],
    ['#m=nope', { level: 'home' }, null],
  ])('%s', (hash, route, sheet) => {
    expect(parseHash(hash)).toEqual({ route, sheet });
  });
  it('the safety record link (#p=safety) leaves the route as it was', () => {
    expect(parseHash('#m=book&p=safety').route).toEqual({ level: 'module', module: 'book' });
  });
});

describe('the new layers round-trip through the hash', () => {
  it.each<[Route, string]>([
    [{ level: 'waiting' }, '#w=waiting'],
    [{ level: 'waiting', module: 'rescue' }, '#w=waiting&f=rescue'],
    [{ level: 'rewind' }, '#r=rewind'],
    [{ level: 'deal', deal: '01JDEAL', from: { module: 'book', view: 'ledger' } }, '#d=01JDEAL&m=book&v=ledger'],
    [{ level: 'deal', deal: '01JDEAL', from: { module: 'spend' } }, '#d=01JDEAL&m=spend'],
  ])('%j', (route, hash) => {
    expect(formatHash(route, null)).toBe(hash);
    expect(parseHash(hash).route).toEqual(route);
  });
  it('#c=centre is the centre, and a filter that is not a module is dropped', () => {
    expect(parseHash('#c=centre').route).toEqual({ level: 'home' });
    expect(parseHash('#w=waiting&f=nope').route).toEqual({ level: 'waiting' });
    expect(parseHash('#d=X&m=book&v=Bad%20View!').route).toEqual({ level: 'deal', deal: 'X', from: { module: 'book' } });
  });
});

describe('the chain of layers', () => {
  it('derives depth 1 to 4 from the route', () => {
    expect(depthOf({ level: 'home' }, ctx)).toBe(1);
    for (const r of [{ level: 'waiting' }, { level: 'rewind' }, { level: 'setup', step: 'keys' }, { level: 'module', module: 'spend' }] as Route[]) expect(depthOf(r, ctx)).toBe(2);
    expect(depthOf({ level: 'module', module: 'book', view: 'ledger' }, ctx)).toBe(3);
    expect(depthOf({ level: 'deal', deal: 'D-0193' }, ctx)).toBe(3);
    expect(depthOf({ level: 'deal', deal: '01JDEAL', from: { module: 'book', view: 'ledger' } }, ctx)).toBe(4);
  });
  it('walks up: a deal to the page it came from, else its own module; an unknown view to the centre', () => {
    expect(parentOf({ level: 'deal', deal: '01JDEAL', from: { module: 'book', view: 'ledger' } }, ctx)).toEqual({ level: 'module', module: 'book', view: 'ledger' });
    expect(parentOf({ level: 'deal', deal: 'D-0193' }, ctx)).toEqual({ level: 'module', module: 'tables' });
    expect(parentOf({ level: 'deal', deal: 'unknown' }, ctx)).toEqual({ level: 'home' });
    expect(parentOf({ level: 'module', module: 'book', view: 'ghost' }, ctx)).toEqual({ level: 'home' });
    expect(parentOf({ level: 'waiting', module: 'spend' }, ctx)).toEqual({ level: 'home' });
    expect(parentOf({ level: 'home' }, ctx)).toBeNull();
    expect(chainOf({ level: 'deal', deal: '01JDEAL', from: { module: 'book', view: 'ledger' } }, ctx).map(routeKey)).toEqual(['centre', 'm:book', 'm:book:ledger', 'd:01JDEAL']);
  });
  it('names the direction of a move and the module tab it lights', () => {
    expect(directionOf({ level: 'home' }, { level: 'module', module: 'spend' }, ctx)).toBe('into');
    expect(directionOf({ level: 'deal', deal: 'D-0193' }, { level: 'module', module: 'tables' }, ctx)).toBe('out');
    expect(directionOf({ level: 'module', module: 'spend' }, { level: 'module', module: 'book' }, ctx)).toBe('swap');
    expect(isAncestor({ level: 'module', module: 'tables' }, { level: 'deal', deal: 'D-0193' }, ctx)).toBe(true);
    expect(isAncestor({ level: 'module', module: 'spend' }, { level: 'deal', deal: 'D-0193' }, ctx)).toBe(false);
    expect(moduleOfRoute({ level: 'deal', deal: 'D-0193' }, ctx)).toBe('tables');
    expect(moduleOfRoute({ level: 'waiting' }, ctx)).toBeNull();
  });
});
