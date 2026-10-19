// S1 in the approval window, on the mock backend's own deals: a price above 1.4 x the market's typical
// price is drawn as the HOLD (its words from lib/words), and a deal with no market reference says the
// price check was skipped, not passed, and never draws a passing row or a market band.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ApprovalSummary } from '@bindings/ApprovalSummary';
import { shieldRuleWord, shieldWord } from '../../../lib/words';
import { mockBackend, resetMockState } from '../../../mock/backend';
import { buildDiff } from './diff';
import { DiffTable, MarketLine, MarketTrack } from './Parts';

afterEach(() => { cleanup(); resetMockState(); history.replaceState(null, '', '/'); });

async function summaryOf(pick: (d: { id: string; state: string; shield: string | null; market: unknown }) => boolean): Promise<ApprovalSummary> {
  const deal = (await mockBackend('main').invoke('list_deals', null)).find(pick);
  if (!deal) throw new Error('the mock world has no such deal');
  history.replaceState(null, '', `/approval.html?deal=${deal.id}`);
  return mockBackend('approval').invoke('approval_summary', { deal_id: deal.id });
}

const input = (summary: ApprovalSummary) => ({
  summary, mandate: undefined, clauseNumber: null, counterparty: { name: 'pixel-bay', known: true },
  band: null, transcript: undefined, ownerAccept: false, now: Math.floor(Date.now() / 1000),
});
const noop = () => {};

describe('S1 in the approval window', () => {
  it('a price above 1.4 x the market reference is drawn as the paused HOLD, in the shield’s words', async () => {
    const s = await summaryOf((d) => d.shield === 'HOLD' && d.state === 'AGREED');
    const d = s.deal;
    expect(d.shield_rule).toBe('price_over_market');
    expect(d.market).not.toBeNull();
    expect(d.terms.unit_price.minor).toBeGreaterThan(d.market!.median.minor * 1.4);
    const diff = buildDiff(input(s));
    expect(diff.kind).toBe('hold');
    const { container } = render(<DiffTable heads={diff.heads} rows={diff.rows} set="pre" onOpen={noop} open={null} />);
    const rule = container.querySelector('.dr-row.hold');
    expect(rule?.textContent).toContain(shieldRuleWord('price_over_market').text);
    expect(rule?.getAttribute('aria-label')).toContain('Scam check');
    // Drawn as a pause: no passing row is the scam check, and no row offers to pay.
    expect(container.querySelectorAll('.dr-row.ok .dn')).toSatisfy((rows: NodeListOf<Element>) => ![...rows].some((r) => r.textContent === 'Scam check'));
    expect(container.textContent).not.toMatch(/Looks safe|pay now/i);
    expect(shieldWord('HOLD').text).toBe('Paused for you');
    const mkt = render(<MarketLine deal={d} onInfo={noop} />);
    expect(mkt.container.textContent).toContain('usually');
    expect(mkt.container.textContent).not.toContain('skipped');
  });

  it('a deal with no market reference says the price check was skipped, not passed, and is never drawn as passed', async () => {
    const s = await summaryOf((d) => d.state === 'AWAITING_APPROVAL' && d.market === null);
    expect(s.deal.market).toBeNull();
    const line = render(<MarketLine deal={s.deal} onInfo={noop} />);
    expect(line.container.textContent).toContain('no reference for this item, so the price check was skipped');
    expect(line.container.querySelector('.mini, .mw')).toBeNull();
    line.unmount();
    const track = render(<MarketTrack deal={s.deal} />);
    expect(track.container.textContent).toBe('No market price for this item, so the price check was skipped, not passed.');
    expect(track.container.querySelector('.dr-track')).toBeNull();
    track.unmount();
    // The same deal held for want of a reference: the diff's market row is an unknown, not a pass.
    const held = { ...s, deal: { ...s.deal, state: 'AGREED' as const, shield: 'HOLD' as const, shield_rule: 'no_market_reference' as const } };
    const diff = buildDiff(input(held));
    const row = diff.rows.find((r) => r.id === 'market');
    expect(row).toMatchObject({ rel: '?', tone: 'info', src: 'No market reference for this item, so the price check was skipped, not passed.' });
    const { container } = render(<DiffTable heads={diff.heads} rows={[row!]} set="pre" onOpen={noop} open={null} />);
    expect(container.querySelector('.dr-row.ok')).toBeNull();
    expect(container.querySelector('.dr-row')?.className).toContain('unk');
  });
});
