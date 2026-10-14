// The console's routes: every older link still parses to the same place, the new layers round-trip
// through the hash, and the chain of layers (depth 1-4, parents, the direction of a move) comes
// from the route alone.
import { describe, expect, it } from 'vitest';
import type { Module } from '@bindings/Module';
import { formatHash, parseHash, type Route } from '../logic';
import { chainOf, depthOf, directionOf, isAncestor, moduleOfRoute, mountKey, parentOf, routeKey, type ChainCtx } from './route';

const ctx: ChainCtx = {
  dealModule: (d) => (d === 'D-0193' || d === '01JDEAL' ? 'tables' : null),
  knownView: (m: Module, v: string) => m === 'book' && (v === 'ledger' || v === 'ask'),
};

describe('older links still land where they did', () => {
  // WP2.5: the old sheets (#s=settings|pairing|mandates, drawn over any route) and the safety
  // sheet (&p=safety) are layers now; their links open the layer that was in front.
  it.each<[string, Route]>([
    ['', { level: 'home' }],
    ['#m=spend', { level: 'module', module: 'spend' }],
    ['#m=book&v=ledger', { level: 'module', module: 'book', view: 'ledger' }],
    ['#d=D-0193', { level: 'deal', deal: 'D-0193' }],
    ['#d=01JDEAL&s=settings', { level: 'place', place: 'settings' }],
    ['#s=settings', { level: 'place', place: 'settings' }],
    ['#s=pairing', { level: 'place', place: 'pairing' }],
    ['#s=mandates', { level: 'place', place: 'rules' }],
    ['#s=setup&step=rules', { level: 'setup', step: 'rules' }],
    ['#s=setup', { level: 'setup', step: 'keys' }],
    ['#m=nope', { level: 'home' }],
  ])('%s', (hash, route) => {
    expect(parseHash(hash)).toEqual({ route });
  });
  it('the safety record link (#m=book&p=safety) opens the record a layer below Book', () => {
    expect(parseHash('#m=book&p=safety').route).toEqual({ level: 'place', place: 'safety', from: 'book' });
    expect(parseHash('#p=safety').route).toEqual({ level: 'place', place: 'safety' });
    expect(parseHash('#d=X&p=safety').route).toEqual({ level: 'place', place: 'safety' });
  });
});

describe('the new layers round-trip through the hash', () => {
  it.each<[Route, string]>([
    [{ level: 'waiting' }, '#w=waiting'],
    [{ level: 'waiting', module: 'rescue' }, '#w=waiting&f=rescue'],
    [{ level: 'rewind' }, '#r=rewind'],
    [{ level: 'deal', deal: '01JDEAL', from: { module: 'book', view: 'ledger' } }, '#d=01JDEAL&m=book&v=ledger'],
    [{ level: 'deal', deal: '01JDEAL', from: { module: 'spend' } }, '#d=01JDEAL&m=spend'],
    [{ level: 'place', place: 'rules' }, '#p=rules'],
    [{ level: 'place', place: 'limits' }, '#p=limits'],
    [{ level: 'place', place: 'connections' }, '#p=connections'],
    [{ level: 'place', place: 'pairing', from: 'settings' }, '#p=pairing&m=settings'],
    [{ level: 'place', place: 'settings' }, '#p=settings'],
    [{ level: 'place', place: 'safety', from: 'book' }, '#p=safety&m=book'],
  ])('%j', (route, hash) => {
    expect(formatHash(route)).toBe(hash);
    expect(parseHash(hash).route).toEqual(route);
  });
  it.each<[Route, string]>([
    [{ level: 'deal', deal: '01JDEAL', view: 'who' }, '#d=01JDEAL&dv=who'],
    [{ level: 'deal', deal: '01JDEAL', from: { module: 'book', view: 'ledger' }, view: 'proof' }, '#d=01JDEAL&m=book&v=ledger&dv=proof'],
    [{ level: 'deal', deal: '01JDEAL', from: { module: 'spend' }, view: 'story' }, '#d=01JDEAL&m=spend&dv=story'],
    [{ level: 'place', place: 'settings', view: 'agents' }, '#p=settings&v=agents'],
    [{ level: 'place', place: 'connections', from: 'settings', view: 'paypal' }, '#p=connections&m=settings&v=paypal'],
  ])('a card view: %j', (route, hash) => {
    expect(formatHash(route)).toBe(hash);
    expect(parseHash(hash).route).toEqual(route);
  });
  it('a card view keeps every older deal link meaning what it did', () => {
    // `v` after `&m=` is still the module view the deal was opened from
    expect(parseHash('#d=X&m=book&v=ledger').route).toEqual({ level: 'deal', deal: 'X', from: { module: 'book', view: 'ledger' } });
    // with no `&m=`, `v` is the deal's own view (the Director's short form)
    expect(parseHash('#d=X&v=who').route).toEqual({ level: 'deal', deal: 'X', view: 'who' });
    // free text never reaches a view key
    expect(parseHash('#p=settings&v=Bad%20View!').route).toEqual({ level: 'place', place: 'settings' });
    expect(parseHash('#d=X&dv=%3Cscript%3E').route).toEqual({ level: 'deal', deal: 'X' });
  });
  it('#c=centre is the centre, and a filter that is not a module is dropped', () => {
    expect(parseHash('#c=centre').route).toEqual({ level: 'home' });
    expect(parseHash('#w=waiting&f=nope').route).toEqual({ level: 'waiting' });
    expect(parseHash('#d=X&m=book&v=Bad%20View!').route).toEqual({ level: 'deal', deal: 'X', from: { module: 'book' } });
    // a place is never its own origin, and an unknown place is no place
    expect(parseHash('#p=settings&m=settings').route).toEqual({ level: 'place', place: 'settings' });
    expect(parseHash('#p=nope').route).toEqual({ level: 'home' });
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
  it('places: depth 2 above the centre, 3 under their parent or the page they were opened from', () => {
    for (const p of ['rules', 'connections', 'settings', 'safety'] as const) expect(depthOf({ level: 'place', place: p }, ctx)).toBe(2);
    expect(chainOf({ level: 'place', place: 'limits' }, ctx).map(routeKey)).toEqual(['centre', 'p:rules', 'p:limits']);
    expect(chainOf({ level: 'place', place: 'pairing' }, ctx).map(routeKey)).toEqual(['centre', 'p:connections', 'p:pairing']);
    expect(chainOf({ level: 'place', place: 'pairing', from: 'settings' }, ctx).map(routeKey)).toEqual(['centre', 'p:settings', 'p:pairing:settings']);
    expect(chainOf({ level: 'place', place: 'safety', from: 'book' }, ctx).map(routeKey)).toEqual(['centre', 'm:book', 'p:safety:book']);
    expect(moduleOfRoute({ level: 'place', place: 'safety', from: 'book' }, ctx)).toBeNull();
    expect(isAncestor({ level: 'place', place: 'rules' }, { level: 'place', place: 'limits' }, ctx)).toBe(true);
  });
  it('a deal or a place card view is one more layer (depth up to 5); an unknown view is stepped over', () => {
    const sheet: ChainCtx = { ...ctx, knownSheetView: (r) => (r.level === 'deal' ? r.view === 'who' : r.level === 'place' ? r.view === 'agents' : true) };
    const deep: Route = { level: 'deal', deal: '01JDEAL', from: { module: 'book', view: 'ledger' }, view: 'who' };
    expect(chainOf(deep, sheet).map(routeKey)).toEqual(['centre', 'm:book', 'm:book:ledger', 'd:01JDEAL', 'd:01JDEAL/who']);
    expect(depthOf(deep, sheet)).toBe(5);
    expect(parentOf(deep, sheet)).toEqual({ level: 'deal', deal: '01JDEAL', from: { module: 'book', view: 'ledger' } });
    expect(parentOf({ level: 'place', place: 'settings', view: 'agents' }, sheet)).toEqual({ level: 'place', place: 'settings' });
    expect(chainOf({ level: 'place', place: 'pairing', from: 'settings', view: 'agents' }, sheet).map(routeKey)).toEqual(['centre', 'p:settings', 'p:pairing:settings', 'p:pairing:settings/agents']);
    // unknown: the chain is the sheet's own, and Back leaves the sheet
    expect(chainOf({ level: 'place', place: 'settings', view: 'ghost' }, sheet).map(routeKey)).toEqual(['centre', 'p:settings']);
    expect(parentOf({ level: 'place', place: 'settings', view: 'ghost' }, sheet)).toEqual({ level: 'home' });
    expect(directionOf({ level: 'place', place: 'settings' }, { level: 'place', place: 'settings', view: 'agents' }, sheet)).toBe('into');
    expect(isAncestor({ level: 'deal', deal: 'D-0193' }, { level: 'deal', deal: 'D-0193', view: 'who' }, sheet)).toBe(true);
    expect(mountKey({ level: 'deal', deal: 'D-0193', view: 'who' })).toBe(mountKey({ level: 'deal', deal: 'D-0193' }));
    expect(routeKey({ level: 'deal', deal: 'D-0193', view: 'who' })).not.toBe(routeKey({ level: 'deal', deal: 'D-0193' }));
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
