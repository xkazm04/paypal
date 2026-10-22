// The one event -> invalidation map (lib/data/invalidation.ts). Events only mark reads stale; the
// map names which. A ledger event about one deal touches that deal's reads only.
import { describe, expect, it } from 'vitest';
import type { Deal } from '@bindings/Deal';
import { buildMockState } from '../../mock/fixtures';
import { INVALIDATION, MAPPED_EVENTS, eventDealId, targetsFor } from './invalidation';
import { PER_DEAL_COMMANDS, WORLD_KEYS, dealKey, keyOf } from './keys';
import { EVENT_AUDIENCE } from '@bindings/authority';

const deal: Deal = buildMockState(1_800_000_000).deals[0]!.deal;
const keys = (ts: { key: readonly unknown[]; dealId?: string }[]) => ts.map((t) => JSON.stringify(t.dealId ? [...t.key, `@${t.dealId}`] : t.key));

describe('the event -> invalidation map', () => {
  it('deal:changed: the deal list, attention, counterparties, and that deal’s own reads', () => {
    const t = keys(targetsFor('deal:changed', { deal, mode: deal.mode }));
    expect(t).toEqual(expect.arrayContaining([
      JSON.stringify(WORLD_KEYS.deals),
      JSON.stringify(WORLD_KEYS.attention),
      JSON.stringify(['counterparties']),
      JSON.stringify(['deal_display', deal.id]),
      JSON.stringify(['deal_evidence', deal.id]),
      JSON.stringify(['deal_transcript', deal.id]),
      JSON.stringify(['cmd', 'deal_history', `@${deal.id}`]),
    ]));
    // never another deal's reads, never the settings or the runs
    expect(t).not.toContain(JSON.stringify(['deal_display']));
    expect(t).not.toContain(JSON.stringify(WORLD_KEYS.settings));
    expect(t).not.toContain(JSON.stringify(WORLD_KEYS.runs));
  });

  it('attention:changed -> attention; settings:changed -> settings and attention; agent:changed -> runs', () => {
    expect(keys(targetsFor('attention:changed', { items: [], locked: false } as never))).toEqual([JSON.stringify(WORLD_KEYS.attention)]);
    expect(keys(targetsFor('settings:changed', {} as never))).toEqual([JSON.stringify(WORLD_KEYS.settings), JSON.stringify(WORLD_KEYS.attention)]);
    expect(keys(targetsFor('agent:changed', {} as never))).toEqual([JSON.stringify(WORLD_KEYS.runs)]);
  });

  it('receipt:created -> the deal list and that deal’s evidence and display', () => {
    const t = keys(targetsFor('receipt:created', { deal_id: deal.id } as never));
    expect(t).toEqual([JSON.stringify(WORLD_KEYS.deals), JSON.stringify(['deal_evidence', deal.id]), JSON.stringify(['deal_display', deal.id])]);
  });

  it('events with no rule invalidate nothing, and the provider listens to exactly the mapped events', () => {
    expect(targetsFor('tumbler:visual', {} as never)).toEqual([]);
    expect(targetsFor('main:route', {} as never)).toEqual([]);
    expect([...MAPPED_EVENTS].sort()).toEqual(['agent:changed', 'attention:changed', 'deal:changed', 'receipt:created', 'settings:changed']);
    expect(Object.keys(INVALIDATION)).toHaveLength(5);
  });

  it('is derived, not hand-kept: a deal change reaches every per-deal read, and main hears every mapped event', () => {
    const t = keys(targetsFor('deal:changed', { deal, mode: deal.mode }));
    for (const cmd of PER_DEAL_COMMANDS) expect(t, cmd).toContain(JSON.stringify(dealKey(cmd, deal.id)));
    // The map is applied only in the main window ('main' scope): an event Rust does not send there
    // would make its rule dead code.
    for (const e of MAPPED_EVENTS) expect(EVENT_AUDIENCE[e], e).toContain('main');
  });

  it('knows the deal of a ledger event, and of nothing else', () => {
    expect(eventDealId('deal:changed', { deal, mode: deal.mode })).toBe(deal.id);
    expect(eventDealId('receipt:created', { deal_id: 'D1' })).toBe('D1');
    expect(eventDealId('attention:changed', { items: [] })).toBeNull();
  });
});

describe('query keys', () => {
  it('world reads have names; per-deal reads are keyed by deal; everything else by command and args', () => {
    expect(keyOf('get_settings', null).key).toEqual(['world', 'settings']);
    expect(keyOf('list_deals', null).key).toEqual(['world', 'deals']);
    expect(keyOf('attention_list', null).key).toEqual(['world', 'attention']);
    expect(keyOf('agent_runs', null).key).toEqual(['world', 'runs']);
    expect(keyOf('counterparty_list', null).key).toEqual(['counterparties']);
    expect(keyOf('mandate_list', null).key).toEqual(['mandates']);
    expect(keyOf('deal_display', { deal_id: 'D1' })).toMatchObject({ key: ['deal_display', 'D1'], dealId: 'D1' });
    expect(keyOf('deal_transcript', { deal_id: 'D1' }).key).toEqual(['deal_transcript', 'D1']);
    expect(keyOf('owner_facts', null)).toMatchObject({ key: ['cmd', 'owner_facts', null], dealId: null, policy: { staleTime: 0, gcTime: 0 } });
    expect(keyOf('deal_history', { deal_id: 'D1', from: 1, to: 2 }).dealId).toBe('D1');
    expect(keyOf('deal_history', { deal_id: null, from: 1, to: 2 }).dealId).toBeNull();
  });
});
