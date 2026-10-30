// @vitest-environment node
// "Provable by both sides": the shop's file and the buyer's file of one sale agree on everything they
// both say, and any difference shows up on the line it is about.
import { describe, expect, it } from 'vitest';
import busy from './sample/busy.tableproof?raw';
import buyer from './sample/buyer.tableproof?raw';
import golden from './sample/golden.tableproof?raw';
import { applyEdits } from './edits';
import { compareSides, sideOf, type Agreement } from './sides';
import { editsFor } from './tamper';
import { checkProofText, prepareProof } from './verify';

const side = async (text: string) => {
  const prepared = await prepareProof(text);
  if ('refused' in prepared) throw new Error(prepared.refused);
  const outcome = await checkProofText(text, null);
  return sideOf(prepared, 'report' in outcome && outcome.report.verified);
};
const by = (lines: Agreement[]) => Object.fromEntries(lines.map((l) => [l.id, l.agree]));

describe('the shop’s file and the buyer’s file of the same sale', () => {
  it('agree on the deal, the sides, the keys, the messages, the price and the payment', async () => {
    const lines = compareSides(await side(golden), await side(buyer));
    expect(by(lines)).toEqual({ each: true, deal: true, sides: true, keys: true, messages: true, price: true, payment: true });
    expect(lines.find((l) => l.id === 'messages')?.detail).toMatch(/^both end at the same signed message, [0-9a-f]{12}…$/);
    expect(lines.find((l) => l.id === 'price')?.detail).toBe('both say 212.00 USD');
  });

  it('say so from either end', async () => {
    expect(by(compareSides(await side(buyer), await side(golden)))).toEqual(by(compareSides(await side(golden), await side(buyer))));
  });

  it('disagree on the price when one file’s price is raised, and that file no longer checks out', async () => {
    const doc: unknown = JSON.parse(golden);
    applyEdits(doc, editsFor('price', doc) ?? []);
    const lines = compareSides(await side(JSON.stringify(doc)), await side(buyer));
    expect(by(lines)).toMatchObject({ each: false, price: false, deal: true, messages: true });
    expect(lines.find((l) => l.id === 'price')?.detail).toBe('296.80 USD against 212.00 USD');
  });

  it('disagree about where the messages end when one file is cut short', async () => {
    const doc: unknown = JSON.parse(buyer);
    applyEdits(doc, editsFor('transcript-head', doc) ?? []);
    expect(by(compareSides(await side(golden), await side(JSON.stringify(doc))))).toMatchObject({ messages: false, each: false });
  });

  it('are not about the same deal when two different deals are put together', async () => {
    const lines = compareSides(await side(busy), await side(buyer));
    expect(by(lines)).toMatchObject({ deal: false, messages: false, price: false, sides: true, keys: true }); // two deals of the same two owners
  });

  it('read one file against itself as two files from the same side', async () => {
    const lines = compareSides(await side(golden), await side(golden));
    expect(by(lines)).toMatchObject({ deal: true, sides: false, keys: false });
  });
});
