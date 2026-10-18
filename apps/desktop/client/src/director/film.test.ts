// The demo film's capture adapter (?take=film): the pure parts. Rectangles measured inside a framed
// window land on the recorded page through the frame's place on the desk and the desk's transform,
// and the haggle's figures come from the mock world's deal and its signed mandate, never constants.
import { describe, expect, it } from 'vitest';
import { buildMockState } from '../mock/fixtures';
import { HAGGLE } from './helpers';
import { centre, deskTransform, FILM_PRESS, filmTarget, haggleRecord, recordShown, stageRect, usdText } from './takes';

describe('film rectangles', () => {
  it('splits a frame prefix from the selector, and leaves page selectors alone', () => {
    expect(filmTarget('main|.deal-head h1')).toEqual({ frame: 'main', css: '.deal-head h1' });
    expect(filmTarget('tumbler|.f.ticker, .puck-art')).toEqual({ frame: 'tumbler', css: '.f.ticker, .puck-art' });
    expect(filmTarget('approval|button')).toEqual({ frame: 'approval', css: 'button' });
    expect(filmTarget('.dir-banner')).toEqual({ frame: null, css: '.dir-banner' });
    // a CSS pseudo or attribute selector with a bar is not a frame prefix
    expect(filmTarget('[lang|=en]')).toEqual({ frame: null, css: '[lang|=en]' });
    expect(filmTarget('other|x')).toEqual({ frame: null, css: 'other|x' });
  });

  it('reads the desk transform from its computed matrix (identity when there is none)', () => {
    expect(deskTransform({ a: 0.9, e: 60, f: 18 })).toEqual({ tx: 60, ty: 18, s: 0.9 });
    expect(deskTransform(null)).toEqual({ tx: 0, ty: 0, s: 1 });
  });

  it('maps an iframe-local rectangle to page pixels at scale 1', () => {
    // The Table's iframe sits at desk (40, 64): its section at (40, 34) plus the 30 px title bar.
    // The desk is centred in a 1920 x 1046 stage under the 34 px banner: translate(60, 18).
    const r = stageRect({ x: 100, y: 200, w: 300, h: 40 }, { x: 40, y: 64 }, { tx: 60, ty: 18, s: 1 }, { x: 0, y: 34 });
    expect(r).toEqual({ x: 200, y: 316, w: 300, h: 40 });
  });

  it('maps an iframe-local rectangle through a scaled desk', () => {
    // scale 0.5 from the desk's top-left corner, desk translated by (100, 50), stage at (0, 34)
    const r = stageRect({ x: 10, y: 20, w: 200, h: 100 }, { x: 1274, y: 540 }, { tx: 100, ty: 50, s: 0.5 }, { x: 0, y: 34 });
    expect(r).toEqual({ x: 100 + 0.5 * 1284, y: 34 + 50 + 0.5 * 560, w: 100, h: 50 });
    expect(centre(r)).toEqual({ x: 792, y: 389 });
  });

  it('names a press target in a framed window for the beats whose action stands in for a click', () => {
    for (const [beat, sel] of Object.entries(FILM_PRESS)) {
      expect(filmTarget(sel).frame, beat).toBe('tumbler');
    }
  });
});

describe('film record: the haggle', () => {
  const state = buildMockState(1_800_000_000);
  const deal = state.deals.find((d) => d.display.label === HAGGLE);
  if (!deal) throw new Error('no haggle in the fixtures');
  const mandate = state.mandates.find((m) => m.payload.id === deal.deal.mandate_id && m.payload.version === deal.deal.mandate_version);
  if (!mandate) throw new Error('no signed mandate for the haggle');
  /** The deal as MockWorld.rewind shows it after its first `upTo` signed steps. */
  const upTo = (n: number) => ({
    ...deal,
    transcript: deal.transcript.filter((t) => t.seq <= n),
    attention: n >= deal.transcript.length ? deal.attention : null,
  });

  it('reads the ceiling and the ask-me threshold from the signed mandate', () => {
    const rec = haggleRecord(upTo(2), mandate.payload.clauses);
    expect(rec.ceiling).toBe(340);
    expect(rec.askAbove).toBe(250);
    expect(rec.offersMaya).toEqual([290]);
    expect(rec.offersDan).toEqual([389]);
    expect('gateAt' in rec).toBe(false);
  });

  it('follows the trade step by step, and raises the gate at Dan’s last counter', () => {
    expect(haggleRecord(upTo(10), mandate.payload.clauses)).toEqual({
      ceiling: 340, askAbove: 250, offersMaya: [290, 305, 314, 321, 327], offersDan: [389, 372, 355, 344, 333],
    });
    const gate = haggleRecord(upTo(Number.MAX_SAFE_INTEGER), mandate.payload.clauses);
    expect(gate.offersDan.at(-1)).toBe(329);
    expect(gate.gateAt).toBe(329);
    // every one of her offers stays inside her signed ceiling
    expect(Math.max(...gate.offersMaya)).toBeLessThanOrEqual(gate.ceiling ?? 0);
  });

  it('changes with the fixtures, not with a typed constant: a re-signed rule moves the record', () => {
    const resigned = mandate.payload.clauses.map((c) => (c.type === 'human_present_over' ? { ...c, amount: { ...c.amount, minor: 30_000 } } : c));
    expect(haggleRecord(upTo(2), resigned).askAbove).toBe(300);
    // without the mandate, the deal's own band still gives the ceiling; no threshold is invented
    const bare = haggleRecord(upTo(2));
    expect(bare.ceiling).toBe(340);
    expect('askAbove' in bare).toBe(false);
  });

  it('checks the record against what The Table draws', () => {
    expect(usdText(1234)).toBe('$1,234.00');
    const rec = haggleRecord(upTo(Number.MAX_SAFE_INTEGER), mandate.payload.clauses);
    expect(recordShown(rec, 'Accept Dan’s $329.00? … $327.00')).toEqual([]);
    expect(recordShown(rec, 'Accept Dan’s $329.00?')).toEqual(['the record says $327.00, The Table does not show it']);
  });
});
