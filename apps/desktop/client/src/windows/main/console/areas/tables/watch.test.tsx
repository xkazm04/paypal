// "Watch the haggle" on Maya's sample week: the view renders healthy and opens on the house seller's
// recorded table, every step it lists is the engine's (mock/haggle.json), the refusal is the
// wallet's, it moves no money, and the decision centre shows the same haggle at a glance above
// Dan's decision, decorative, with Watch it as the way in.
import { cleanup, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shortMoney } from '../../../../../lib/format';
import { TABLES_VIEWS, TABLES_WATCH } from '../../../../../lib/words';
import { RECORDED } from '../../../../../mock/haggle';
import { expectLayerHealthy, renderLayerAtScale, type LayerRun } from '../../testing/scaleSmoke';

vi.mock('../../../../../lib/runtime', async () => (await import('../../testing/runtime')).runtimeMock);

afterEach(() => { cleanup(); history.replaceState(null, '', '/'); });

const usd = (minor: number) => shortMoney(minor, 'USD');
const moved = (r: LayerRun) => r.calls.filter((c) => !/^(list_|get_|deal_display|deal_transcript|deal_evidence|deal_groups|attention_list|agent_runs|counterparty_|mandate_list|engine_status|safety_record|deal_history|settings|owner_facts)/.test(c.cmd));

describe('Watch the haggle', () => {
  it('opens on the recorded house table and lists exactly the engine’s run', async () => {
    const r = await renderLayerAtScale({ level: 'module', module: 'tables', view: 'watch' }, null);
    expectLayerHealthy(r);
    expect(r.layer.querySelector('h1')?.textContent).toBe(TABLES_VIEWS.watch);
    await waitFor(() => expect(r.layer.querySelectorAll('.hc-steps li').length).toBeGreaterThan(0), { timeout: 10_000 });
    const steps = [...r.layer.querySelectorAll('.hc-steps li')].map((li) => li.textContent ?? '');
    const house = RECORDED.house.steps;
    // One line per recorded step: the house's closing accept is read out as the agreement itself.
    expect(steps).toHaveLength(house.length);
    expect(steps[0]).toBe(TABLES_WATCH.lists('House seller', usd(house[0]!.price)));
    expect(steps[1]).toBe(TABLES_WATCH.opens(usd(house[1]!.price)));
    const refusal = steps.find((s) => s.includes('the wallet refuses: not the agent'));
    expect(refusal).toBe(TABLES_WATCH.refusedYes(usd(RECORDED.house.outcome.price), usd(RECORDED.house.rules.ask_above)));
    expect(steps.at(-1)).toContain(TABLES_WATCH.agreed(usd(RECORDED.house.outcome.price)));
    // Every figure the steps name is one of the recording's (or her ask-me line).
    const figures = new Set([...house.map((s) => usd(s.price)), usd(RECORDED.house.rules.ask_above)]);
    for (const s of steps) for (const m of s.match(/\$[\d,.]+(?=\b)/g) ?? []) expect(figures.has(m), `${m} in "${s}"`).toBe(true);
    // The replay is a read: a timeline to scrub, and no command that could move money.
    expect(r.layer.querySelector('input.hc-scrub')?.getAttribute('aria-label')).toBe(TABLES_WATCH.timeline);
    expect(moved(r)).toEqual([]);
  }, 60_000);

  it('the decision centre shows the haggle behind Dan’s decision at a glance, with Watch it', async () => {
    const r = await renderLayerAtScale({ level: 'home' }, null);
    await waitFor(() => expect(r.layer.querySelector('.cs-haggle .hc.compact')).toBeTruthy(), { timeout: 10_000 });
    const glance = r.layer.querySelector('.cs-haggle .hc.compact');
    // Decorative: the full replay, with its steps and timeline, is one click away.
    expect(glance?.getAttribute('aria-hidden')).toBe('true');
    expect(glance?.querySelector('.hc-steps, input.hc-scrub')).toBeNull();
    expect(r.layer.querySelector('.cs-haggle-watch')?.textContent).toContain(TABLES_WATCH.watchIt);
    expect(moved(r)).toEqual([]);
  }, 60_000);
});
