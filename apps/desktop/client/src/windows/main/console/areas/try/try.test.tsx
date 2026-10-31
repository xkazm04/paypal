// "Try to break it" (#p=try): Break The Table hosted as a console place. On the browser mock it draws
// its heading and exactly one gold action ("Try an attack"), which plays the next untried recorded
// attack; it sends nothing but reads, takes none of the console's keys, moves to the safety record only
// through LayerNav, is reachable beside the safety record, and its finale checks the attack deal's
// recorded signed file green, then a tamper turns the right check red. Every figure is the record's.
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ARENA_FINALE, ARENA_PLACE, ARENA_PROOF } from '../../../../../lib/words/arena';
import { PLACE_NAME } from '../../../../../lib/words';
import { ATTACK_WORDS, deck } from '../../../../../arena/model';
import { provable } from '../../../../../arena/ArenaProof';
import { nextUntried } from '../../../../../arena/BreakTheTable';
import { RECORD } from '../../../../../arena/record';
import { ARENA_BUNDLE_IDS } from '../../../../../lib/proof/arenaBundles';
import { CHECK_IDS } from '../../../../../lib/proof/checks';
import { expectLayerHealthy, renderLayerAtScale } from '../../testing/scaleSmoke';

vi.mock('../../../../../lib/runtime', async () => (await import('../../testing/runtime')).runtimeMock);
// the real proof checker runs inside the finale; a busy machine slows it
vi.setConfig({ testTimeout: 60_000 });
const SLOW = { timeout: 30_000 };

beforeEach(() => { document.documentElement.classList.add('calm'); });
afterEach(() => { cleanup(); document.documentElement.classList.remove('calm'); history.replaceState(null, '', '/'); });

const TRY = { level: 'place', place: 'try' } as const;
const order = (() => { const d = deck(RECORD.attacks); return [...d.agent, ...d.counterparty]; })();
const gold = (layer: HTMLElement) => [...layer.querySelectorAll<HTMLButtonElement>('.ui-btn.gold')];
const kind = (row: Element | undefined): string => (['ok', 'bad', 'dashed', 'wait', 'now'].find((k) => row?.classList.contains(k)) ?? '');
const rows = (root: ParentNode): Record<string, Element> => Object.fromEntries([...root.querySelectorAll<HTMLElement>('.pk-row')].map((r) => [r.dataset.check ?? '', r]));

describe('Try to break it, a place of the console', () => {
  it('renders on the mock: its heading, the recorded table, one gold action, and nothing but reads', async () => {
    const r = await renderLayerAtScale(TRY, null);
    expect(r.layer.dataset.layer).toBe('try');
    expect(r.layer.querySelector('[data-layer-title]')?.textContent).toBe(ARENA_PLACE.title);
    expect(PLACE_NAME.try).toBe(ARENA_PLACE.title);
    expect(r.layer.querySelector('[data-arena-host="console"]')).toBeTruthy();
    const g = gold(r.layer);
    expect(g).toHaveLength(1);
    expect(g[0]?.textContent).toBe(ARENA_PLACE.attack);
    // every recorded card is in the deck, plus the closing card; none answers to a key here
    expect(r.layer.querySelectorAll('.ar-card')).toHaveLength(RECORD.attacks.length + 1);
    expect(r.layer.querySelectorAll('[aria-keyshortcuts]')).toHaveLength(0);
    // the table is e4's corridor on D-0193's recorded haggle
    expect(r.layer.querySelector('.ar-table .hc')).toBeTruthy();
    expect(r.layer.querySelectorAll('h1')).toHaveLength(1);
    expectLayerHealthy(r);
  });

  it('plays the next untried attack with its one gold action', async () => {
    const r = await renderLayerAtScale(TRY, null);
    const first = nextUntried(order, []);
    expect(first?.id).toBe(order[0]?.id);
    expect(r.layer.querySelector('.ar-answer')).toBeNull();
    fireEvent.click(gold(r.layer)[0] as HTMLElement);
    await within(r.layer).findByText(ATTACK_WORDS[first!.id]!.held, undefined, SLOW);
    const second = nextUntried(order, [first!]);
    fireEvent.click(gold(r.layer)[0] as HTMLElement);
    await within(r.layer).findByText(ATTACK_WORDS[second!.id]!.held, undefined, SLOW);
    // the counter is the record's: two attacks played, PayPal asked as often as the record says
    const asked = [first!, second!].reduce((n, a) => n + a.paypal_requests, 0);
    const counter = within(r.layer.querySelector('.ar-counter') as HTMLElement);
    expect(counter.getByText('2')).toBeTruthy();
    expect(counter.getByText(String(asked))).toBeTruthy();
    expect(gold(r.layer)).toHaveLength(1);
    expectLayerHealthy(r);
  });

  it('opens the safety record through the console, not a new page', async () => {
    const r = await renderLayerAtScale(TRY, null);
    expect(r.layer.querySelector('a[href*="safety"]')).toBeNull();
    fireEvent.click(within(r.layer).getByRole('button', { name: /safety record/ }));
    await waitFor(() => expect(document.querySelector('.cs-layer')?.getAttribute('data-layer')).toBe('safety'), SLOW);
    expect(location.hash).toBe('#p=safety');
  });

  it('is reachable beside the safety record: the row after it in Settings', async () => {
    const r = await renderLayerAtScale({ level: 'place', place: 'settings' }, null);
    const rowsHere = [...r.layer.querySelectorAll('.st-rows li')].map((li) => li.textContent ?? '');
    const safety = rowsHere.findIndex((t) => t.includes(PLACE_NAME.safety));
    expect(safety).toBeGreaterThanOrEqual(0);
    expect(rowsHere[safety + 1]).toContain(ARENA_PLACE.title);
  });

  it('closes on the attack deal’s recorded file, checked green, and a tamper turns the right check red', async () => {
    const r = await renderLayerAtScale(TRY, null);
    // play until an attack with a recorded deal file has been played (Maya's agent's suit leads the deck)
    const played = [];
    for (const a of order) {
      fireEvent.click(gold(r.layer)[0] as HTMLElement);
      await within(r.layer).findByText(ATTACK_WORDS[a.id]!.held, undefined, SLOW);
      played.push(a);
      if (ARENA_BUNDLE_IDS.includes(a.id)) break;
    }
    const id = provable(played)[0];
    expect(id).toBeTruthy();
    fireEvent.click(within(r.layer).getByRole('button', { name: new RegExp(ARENA_FINALE.card) }));
    const proof = await waitFor(() => { const el = r.layer.querySelector<HTMLElement>('.ar-proofcheck'); if (!el) throw new Error('no proof yet'); return el; }, SLOW);
    expect(within(proof).getByText(ARENA_PROOF.label(ATTACK_WORDS[id!]!.title))).toBeTruthy();
    // no link to proof.html in the desktop host: the shell does not serve that page
    expect(proof.querySelector('a[href^="proof.html"]')).toBeNull();
    await within(proof).findAllByText('Every check that applies passed', undefined, SLOW);
    const before = rows(proof);
    expect(Object.keys(before)).toHaveLength(CHECK_IDS.length);
    for (const c of ['format', 'mandate', 'transcript', 'evidence']) expect(kind(before[c]), c).toBe('ok');
    // loosen her signed rules after the fact: the rules check and the seal catch it, the messages still hold
    fireEvent.click(within(proof).getByRole('button', { name: /Loosen the rules after the fact/ }));
    await within(proof).findAllByText('This file does not check out', undefined, SLOW);
    const after = rows(proof);
    expect(CHECK_IDS.filter((c) => kind(after[c]) === 'bad')).toEqual(['mandate', 'evidence']);
    expect(kind(after.transcript)).toBe('ok');
    expect(gold(r.layer)).toHaveLength(1);
    // nothing was sent to the wallet but reads
    expectLayerHealthy(r);
  });
});
