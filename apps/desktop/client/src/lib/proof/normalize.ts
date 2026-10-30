// The wallet reads a proof file into its typed records and signs, hashes and checks those, not the
// bytes. A field the file leaves out that the record allows to be empty (an `Option` with no value) is
// written back as `null`, and a field the record leaves out when empty (a request id, a group) is
// dropped when it is `null`. Taking a file through the same changes before it is hashed makes the page
// hash exactly what the wallet hashes: a file edited by deleting a `null`, or by adding one the wallet
// would not have written, is the same file to both.
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const items = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter(isRec) : []);
/** A field the record writes as `null` when it has no value. */
const nullable = (o: Rec, ...keys: string[]): void => {
  for (const k of keys) if (o[k] === undefined) o[k] = null;
};
/** A field the record leaves out when it has no value. */
const omitted = (o: Rec, ...keys: string[]): void => {
  for (const k of keys) if (o[k] === null) delete o[k];
};

/** The file as the wallet's typed reading of it would write it back. Edits `document` in place. */
export function normalize(document: unknown): void {
  if (!isRec(document)) return;
  omitted(document, 'authority_manifest', 'group', 'house');
  const deal = document.deal;
  if (isRec(deal)) {
    nullable(deal, 'market', 'shield');
    omitted(deal, 'decided_by', 'shield_rule', 'shield_release');
    // a time of zero is "not available": the wallet leaves it out
    for (const k of ['created_at', 'updated_at']) if (deal[k] === 0) delete deal[k];
    if (isRec(deal.paypal)) nullable(deal.paypal, 'order', 'authorization', 'capture', 'subscription');
    const market = deal.market;
    if (isRec(market)) {
      omitted(market, 'certificate');
      if (isRec(market.certificate)) for (const c of items(market.certificate.comparables)) nullable(c, 'product_id');
    }
  }
  const payload = isRec(document.mandate) ? document.mandate.payload : null;
  if (isRec(payload)) for (const clause of items(payload.clauses)) if (clause.type === 'band') nullable(clause, 'floor', 'ceiling');
  for (const o of items(document.operations)) omitted(o, 'request_id');
  for (const c of items(document.paypal_calls)) {
    nullable(c, 'status', 'binding');
    omitted(c, 'request_id');
  }
  for (const r of items(document.receipts)) nullable(r, 'capture_id', 'amount_minor');
  if (isRec(document.group)) nullable(document.group, 'winner');
  if (isRec(document.house)) for (const h of items(document.house.heads)) nullable(h, 'prefix');
}
