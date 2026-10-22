// The bead strip draws a bead for every deal it counts: an invoice is owned by Book (Rust's
// table-attention maps DealKind::Invoice to Module::Book), and Book has no segment of its own, so
// the strip's needs-you count must never include a bead nobody can see.
import { describe, expect, it } from 'vitest';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Deal } from '@bindings/Deal';
import { buildMockState } from '../../../mock/fixtures';
import { moduleOf } from '../logic';
import { beadsByModule, drawnModules } from './BeadStrip';

const NOW = 1_800_000_000;
const template = buildMockState(NOW).deals[0]!.deal;
const deal = (id: string, kind: Deal['kind']): Deal => ({ ...template, id, kind, state: 'AWAITING_APPROVAL', shield: null });
const need = (deal_id: string, module: AttentionItem['module']): AttentionItem => ({
  deal_id, label: 'D-1', kind: 'gate', module, headline: 'Needs you', amount_minor: 100, currency: 'USD',
  counterparty: null, clause: null, deadline: null, on_silence: 'nothing is sent', urgency: 'calm', mode: 'sandbox', actions: ['open_in_table'],
  money_check: null,
});

function strip(deals: Deal[], needs: AttentionItem[]) {
  const byId = new Map(needs.map((n) => [n.deal_id, n]));
  const by = beadsByModule(deals, {
    needOf: (id) => byId.get(id),
    display: (d) => ({ title: d.id }) as ReturnType<Parameters<typeof beadsByModule>[1]['display']>,
    moduleOfDeal: (d) => moduleOf(d, byId.get(d.id)),
  });
  const drawn = drawnModules(by).flatMap((m) => by.get(m.key) ?? []);
  const counted = [...by.values()].flat();
  return { drawn, counted };
}

describe('the bead strip', () => {
  it('draws the bead of an invoice that needs the owner, so the count and the beads agree', () => {
    const { drawn, counted } = strip([deal('inv', 'invoice'), deal('buy', 'purchase')], [need('inv', 'book'), need('buy', 'spend')]);
    expect(counted.filter((b) => b.needs)).toHaveLength(2);
    expect(drawn.filter((b) => b.needs).map((b) => b.id).sort()).toEqual(['buy', 'inv']);
    expect(drawn).toHaveLength(counted.length);
  });
  it('draws an invoice that waits for nobody too', () => {
    const { drawn, counted } = strip([deal('inv', 'invoice')], []);
    expect(drawn.map((b) => b.id)).toEqual(['inv']);
    expect(drawn).toHaveLength(counted.length);
  });
  it('adds no Book segment when Book owns no deal', () => {
    const by = beadsByModule([deal('buy', 'purchase')], { needOf: () => undefined, display: (d) => ({ title: d.id }) as never, moduleOfDeal: (d) => moduleOf(d) });
    expect(drawnModules(by).map((m) => m.key)).not.toContain('book');
  });
});
