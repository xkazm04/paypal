// The Tables layer on the mock worlds (rebuild WP3a): the summary and every nested view render on the
// small shop and the busy merchant with no console error, no raw enum or id on screen, bounded rows
// and the read budget; the transcript is read only for the table that is open (never per row); the
// decision hands off with `approval_open` and nothing else; search, filter and picking work; an empty
// view shrinks to its one calm line; and the area's words keep the vendor and internals rules.
import { act, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bandMovable } from '../../../../approval/gating';
import { TABLES, TABLES_TRADE, TABLES_VIEWS } from '../../../../../lib/words';
import { expectLayerHealthy, renderLayerAtScale, type LayerRun } from '../../testing/scaleSmoke';
import { consequences, diffLines, LIMIT_WORD, standLine, type ConsequenceInput } from '../../../modules/tables/ladder';
import { ladderBandMovable } from './Ladder';
import { wordsOf } from './wordsOf';

vi.mock('../../../../../lib/runtime', async () => (await import('../../testing/runtime')).runtimeMock);

afterEach(() => { cleanup(); history.replaceState(null, '', '/'); });

const reads = (r: LayerRun, cmd: string) => r.calls.filter((c) => c.cmd === cmd).length;
const acts = (r: LayerRun) => r.calls.filter((c) => !/^(list_|get_|deal_display|deal_transcript|deal_evidence|deal_groups|attention_list|agent_runs|counterparty_|mandate_list|engine_status|safety_record|deal_history|approval_open)/.test(c.cmd));

describe('Tables at scale', () => {
  it.each(['small', 'large'] as const)('summary on the %s world', async (scale) => {
    const r = await renderLayerAtScale({ level: 'module', module: 'tables' }, scale);
    expect(r.layer.dataset.layer).toBe('tables');
    expectLayerHealthy(r);
    const cards = r.layer.querySelectorAll('.ml-cards .ui-sumcard');
    expect(cards.length).toBeGreaterThanOrEqual(3);
    expect(cards.length).toBeLessThanOrEqual(4);
    if (scale === 'large') {
      // The waiting decisions: the Your call chip and the needs-you card both say what silence does.
      expect(r.layer.querySelector('[data-fk="your-call"]')).toBeTruthy();
      expect(r.layer.querySelector('.ui-sumcard.needs')?.textContent).toMatch(/If you do nothing/);
    } else {
      expect(r.layer.querySelector('h1')?.textContent).toBe(TABLES.answerNone);
    }
    // The summary reads no transcript at all.
    expect(reads(r, 'deal_transcript')).toBe(0);
  }, 60_000);

  it.each(['need', 'tables', 'ladder', 'shop', 'closed'] as const)('the %s view on the busy world', async (view) => {
    const r = await renderLayerAtScale({ level: 'module', module: 'tables', view }, 'large');
    expectLayerHealthy(r);
    expect(r.layer.querySelector('h1')?.textContent).toBe(TABLES_VIEWS[view]);
    // Visible-only reads: one table open, so at most one transcript (plus one trailing refresh).
    expect(reads(r, 'deal_transcript')).toBeLessThanOrEqual(2);
    expect(acts(r)).toEqual([]);
  }, 60_000);

  it('an empty view shrinks to its calm line (small shop: no tables)', async () => {
    const r = await renderLayerAtScale({ level: 'module', module: 'tables', view: 'tables' }, 'small');
    expect(r.layer.querySelector('.tr-split.empty')).toBeTruthy();
    expect(r.layer.querySelector('.tr-pane')).toBeNull();
    expect(r.layer.textContent).toContain(TABLES.openEmpty);
  }, 60_000);
});

describe('Tables flows', () => {
  it('the decision hands off to the approval window and nothing else', async () => {
    const r = await renderLayerAtScale({ level: 'module', module: 'tables', view: 'need' }, 'large');
    const pane = () => r.layer.querySelector<HTMLElement>('.tr-pane') as HTMLElement;
    const goldIn = () => within(pane()).queryAllByRole('button').find((b) => b.classList.contains('dc-opt') && b.classList.contains('gold'));
    // Pick tables until one asks for a review (a mismatch has no gold, only "Open the deal").
    const rows = [...r.layer.querySelectorAll<HTMLButtonElement>('.tr-list .le-row')];
    for (const row of rows) {
      if (goldIn()) break;
      act(() => { row.click(); });
      await waitFor(() => expect(pane().textContent).toMatch(/If you do nothing/));
    }
    const gold = goldIn();
    expect(gold).toBeTruthy();
    fireEvent.click(gold as HTMLElement);
    await waitFor(() => expect(r.calls.some((c) => c.cmd === 'approval_open')).toBe(true));
    const opened = r.calls.filter((c) => c.cmd === 'approval_open');
    expect(opened).toHaveLength(1);
    expect(Object.keys(opened[0]?.args as object)).toEqual(['deal_id']);
    // Every needs-you decision says what happens if the owner does nothing.
    expect(pane().textContent).toMatch(/If you do nothing/);
    expect(acts(r)).toEqual([]);
  }, 60_000);

  it('picking a table opens it beside the list', async () => {
    const r = await renderLayerAtScale({ level: 'module', module: 'tables', view: 'tables' }, 'large');
    const list = r.layer.querySelector<HTMLElement>('.tr-list');
    const rows = () => [...(list?.querySelectorAll<HTMLButtonElement>('.le-row') ?? [])];
    expect(rows().length).toBeGreaterThan(1);
    const second = rows()[1];
    const label = second?.getAttribute('aria-label') ?? '';
    act(() => { second?.click(); });
    await waitFor(() => expect(label.startsWith(`${r.layer.querySelector('.tr-pane h2')?.textContent ?? '-'}, `)).toBe(true));
  }, 60_000);

  it('search narrows a long list and clearing it brings every row back', async () => {
    // The open tables (8 on the busy world) sit under the toolbar's threshold; the ended list does not.
    const r = await renderLayerAtScale({ level: 'module', module: 'tables', view: 'closed' }, 'large');
    const rows = () => [...r.layer.querySelectorAll<HTMLButtonElement>('.le-row')];
    const before = rows().length;
    const search = r.layer.querySelector<HTMLInputElement>('input[type="search"]');
    expect(search).toBeTruthy();
    fireEvent.change(search as HTMLInputElement, { target: { value: 'zzzz-no-such-table' } });
    await waitFor(() => expect(r.layer.textContent).toMatch(/Nothing matches/));
    fireEvent.change(search as HTMLInputElement, { target: { value: '' } });
    await waitFor(() => expect(rows().length).toBe(before));
  }, 60_000);

  it('names the item on the ladder by its title, never by its code', async () => {
    const r = await renderLayerAtScale({ level: 'module', module: 'tables', view: 'tables' }, 'large');
    await waitFor(() => expect(r.layer.querySelector('.tb-ladder')).toBeTruthy());
    const title = r.layer.querySelector('.tr-pane h2')?.textContent ?? '';
    expect(title).not.toBe('');
    expect(r.layer.querySelector('.tb-ladder')?.getAttribute('aria-label')).toBe(TABLES.ladderLabel(title));
    const grip = r.layer.querySelector('.tb-grip');
    if (grip) expect(grip.getAttribute('aria-label')).toContain(title);
  }, 60_000);

  it('an ended table opens its deal one layer down', async () => {
    const r = await renderLayerAtScale({ level: 'module', module: 'tables', view: 'closed' }, 'large');
    const paid = [...r.layer.querySelectorAll<HTMLButtonElement>('.ui-filter')].find((b) => b.textContent?.startsWith(TABLES.fPaid));
    act(() => { paid?.click(); });
    await waitFor(() => expect(paid?.getAttribute('aria-pressed')).toBe('true'));
    const row = r.layer.querySelector<HTMLButtonElement>('.le-row');
    act(() => { row?.click(); });
    await waitFor(() => expect(location.hash).toMatch(/^#d=/));
  }, 60_000);
});

describe('Tables words', () => {
  it('never name a vendor other than PayPal, an engine, a raw state or an id', () => {
    for (const w of [...wordsOf(TABLES), ...wordsOf(TABLES_TRADE), ...wordsOf(TABLES_VIEWS)]) {
      expect(w).not.toMatch(/claude|codex|openai|anthropic|gpt/i);
      expect(w).not.toMatch(/\b[A-Z]{3,}_[A-Z_]+\b|D-\d{4}|mandate|clause|countersign|_set\b/);
    }
  });
});

describe('Tables ladder: when a price range may move', () => {
  it('is the approval window’s own predicate, not a second copy of its states', () => {
    expect(typeof ladderBandMovable).toBe('function');
    expect(ladderBandMovable).toBe(bandMovable);
  });
});

const FORBIDDEN = [/claude|codex|openai|anthropic|gpt/i, /\b[A-Z]{3,}_[A-Z_]+\b|D-\d{4}|mandate|clause|countersign|_set\b|\bRust\b/];

describe('Tables model sentences', () => {
  const usd = (d: number) => d * 100;
  const base: ConsequenceInput = {
    item: 'the monitor', them: 'Dan', side: 'buyer', signed: { floor: null, ceiling: usd(340) }, draft: { floor: null, ceiling: usd(325) },
    theirs: { seq: 11, price: usd(329), typ: 'COUNTER' }, yours: { seq: 10, price: usd(327), typ: 'COUNTER' },
    roundsUsed: 5, maxRounds: 6, pending: true, currency: 'USD',
  };
  const said = (): string[] => {
    const out: string[] = [];
    for (const side of ['buyer', 'seller'] as const) {
      for (const signed of [null, { floor: usd(300), ceiling: usd(340) }]) {
        for (const draft of [{ floor: null, ceiling: null }, { floor: usd(330), ceiling: usd(325) }, { floor: usd(300), ceiling: usd(345) }]) {
          for (const theirs of [null, base.theirs, { seq: 3, price: usd(500), typ: 'LISTING' as const }]) {
            for (const roundsUsed of [null, 2, 6]) {
              out.push(...consequences({ ...base, side, signed, draft, theirs, roundsUsed, maxRounds: roundsUsed === null ? null : 6 }).map((c) => c.text));
            }
          }
        }
      }
    }
    for (const band of [null, { floor: usd(300), ceiling: usd(340) }, { floor: null, ceiling: null }]) {
      for (const theirs of [null, base.theirs, { seq: 3, price: usd(340), typ: 'LISTING' as const }, { seq: 4, price: usd(400), typ: 'OFFER' as const }]) {
        for (const side of ['buyer', 'seller'] as const) out.push(standLine({ band, theirs, side, who: 'Dan', currency: 'USD' }));
      }
    }
    out.push(...diffLines('m', null, { floor: usd(1), ceiling: usd(2) }, 'USD'), ...diffLines('m', { floor: null, ceiling: usd(1) }, { floor: usd(1), ceiling: usd(1) }, 'USD'), ...Object.values(LIMIT_WORD));
    return out;
  };
  it('say no vendor, id, raw state or internal word, whatever the inputs', () => {
    const all = said();
    expect(all.length).toBeGreaterThan(30);
    for (const w of all) for (const re of FORBIDDEN) expect(w, w).not.toMatch(re);
  });
  it('keep their sentences in lib/words, not in the model', () => {
    const lines = readFileSync(join(process.cwd(), 'src/windows/main/modules/tables/ladder.ts'), 'utf8').split(/\r?\n/);
    const src = lines.filter((l) => !/^\s*(\/\*\*|\*|\/\/)/.test(l)).join(' ');
    expect(src.match(/\b(?:text|tone: '[a-z]+', text):\s*[`'"]|=>\s*`|return\s+`/g) ?? []).toEqual([]);
    expect(src.match(/'(?:none|Most you|Least you)[^']*'/g) ?? []).toEqual([]);
  });
});
