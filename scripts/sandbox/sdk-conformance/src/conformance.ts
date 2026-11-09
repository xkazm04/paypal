// Sandbox-only conformance of the PayPal fields the Rust client (crates/table-paypal) reads,
// exercised through the generated Server SDK (2.5.0). Prints PASS / FAIL / SKIP per field.
// It prints names and verdicts only: never a credential, token, or (unless --approve) a link.
//
//   npm run check                       everything, authorizing with the sandbox test card
//   npm run check -- --approve          authorize through the real buyer approval instead: prints
//                                       two approval links, polls up to 10 minutes (like spike 4)
//   npm run check -- --refund-control   also refund the app's OWN-payee capture (baseline for spike 9)
//   npm run check -- --env <file>       env file (default ../.env.sandbox)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  ApiError,
  CheckoutPaymentIntent,
  Client,
  Environment,
  OrdersController,
  PaymentsController,
} from '@paypal/paypal-server-sdk';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const envFile = opt('--env') ?? process.env.TABLE_SANDBOX_ENV ?? join(here, '..', '..', '.env.sandbox');

function loadEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trimStart().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

// ---- reporting ---------------------------------------------------------------------------
type Verdict = 'PASS' | 'FAIL' | 'SKIP';
const results: { group: string; name: string; verdict: Verdict; note: string }[] = [];
let group = '';
function section(name: string) {
  group = name;
  console.log(`\n== ${name}`);
}
function check(name: string, ok: boolean, note = '') {
  record(name, ok ? 'PASS' : 'FAIL', note);
}
function record(name: string, verdict: Verdict, note = '') {
  results.push({ group, name, verdict, note });
  console.log(`  ${verdict.padEnd(4)} ${name}${note ? `  (${note})` : ''}`);
}

// ---- setup ---------------------------------------------------------------------------------
const env = loadEnv(envFile);
const need = ['PAYPAL_SANDBOX_CLIENT_ID', 'PAYPAL_SANDBOX_SECRET', 'PAYPAL_SANDBOX_MERCHANT_ID'];
const missing = need.filter((k) => !env[k]);
if (missing.length) {
  console.error(`MISSING env names: ${missing.join(', ')} (file: ${envFile})`);
  process.exit(2);
}
const merchant = env.PAYPAL_SANDBOX_MERCHANT_ID;
const client = new Client({
  environment: Environment.Sandbox, // sandbox only: there is no production path in this script
  clientCredentialsAuthCredentials: {
    oAuthClientId: env.PAYPAL_SANDBOX_CLIENT_ID,
    oAuthClientSecret: env.PAYPAL_SANDBOX_SECRET,
  },
});
const orders = new OrdersController(client);
const payments = new PaymentsController(client);

// The wire body is what the Rust client reads, so read the raw body (snake_case) and validate
// the keys our serde structs name, and also let the SDK parse it (typed result).
function wire(res: { body: unknown }): any {
  return JSON.parse(String(res.body));
}
const RESOURCE = /^[A-Za-z0-9_-]{1,128}$/;
const ORDER_STATUS = ['CREATED', 'SAVED', 'APPROVED', 'VOIDED', 'COMPLETED', 'PAYER_ACTION_REQUIRED'];

function money(a: any): boolean {
  return !!a && typeof a.currency_code === 'string' && typeof a.value === 'string' && /^\d+(\.\d+)?$/.test(a.value);
}
function errorSummary(e: unknown): string {
  if (e instanceof ApiError) {
    let name = '';
    try {
      name = JSON.parse(String(e.body)).name ?? '';
    } catch {
      /* not JSON */
    }
    let issue = '';
    try {
      issue = JSON.parse(String(e.body)).details?.[0]?.issue ?? '';
    } catch {
      /* not JSON */
    }
    return `HTTP ${e.statusCode}${name ? ` ${name}` : ''}${issue ? ` / ${issue}` : ''}`;
  }
  return e instanceof Error ? e.message : String(e);
}

const deal = `${Date.now().toString(36).toUpperCase()}${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
const customId = 'a'.repeat(64); // the Rust client sends the 64-hex terms hash here
const amountValue = '1.00';
function createBody(attempt: number) {
  return {
    intent: CheckoutPaymentIntent.Authorize,
    purchaseUnits: [
      {
        amount: { currencyCode: 'USD', value: amountValue },
        invoiceId: `${deal}-${attempt}`,
        customId,
        payee: { merchantId: merchant },
      },
    ],
  };
}

// Reads the order fields crates/table-paypal/src/types.rs (Order, PurchaseUnit, Payments) reads.
function orderFields(label: string, o: any, opts: { authorized?: boolean; invoice: string }) {
  check(`${label} id`, typeof o.id === 'string' && RESOURCE.test(o.id));
  check(`${label} status`, ORDER_STATUS.includes(o.status), `got ${o.status}`);
  check(`${label} intent == AUTHORIZE`, o.intent === 'AUTHORIZE', `got ${o.intent}`);
  const unit = o.purchase_units?.[0];
  check(`${label} purchase_units has exactly one unit`, Array.isArray(o.purchase_units) && o.purchase_units.length === 1);
  check(`${label} purchase_units[0].amount`, money(unit?.amount) && unit.amount.currency_code === 'USD' && unit.amount.value === amountValue, `got ${unit?.amount?.currency_code} ${unit?.amount?.value}`);
  check(`${label} purchase_units[0].invoice_id echoed`, unit?.invoice_id === opts.invoice);
  check(`${label} purchase_units[0].custom_id echoed`, unit?.custom_id === customId);
  check(`${label} purchase_units[0].payee.merchant_id == requested`, unit?.payee?.merchant_id === merchant, unit?.payee?.merchant_id === merchant ? '' : unit?.payee?.merchant_id ? 'a different id' : 'absent');
  if (opts.authorized) {
    const auths = unit?.payments?.authorizations;
    check(`${label} payments.authorizations has one entry`, Array.isArray(auths) && auths.length === 1);
    const a = auths?.[0];
    check(`${label} authorization.id`, typeof a?.id === 'string' && RESOURCE.test(a.id));
    check(`${label} authorization.status == CREATED`, a?.status === 'CREATED', `got ${a?.status}`);
    check(`${label} authorization.amount`, money(a?.amount) && a.amount.value === amountValue);
  }
}

// ---- 1. create an order, no buyer needed ------------------------------------------------
section('create order (POST /v2/checkout/orders)');
const requestId = `${deal}-create`;
let orderId = '';
let createWire: any;
try {
  const res = await orders.createOrder({ body: createBody(1), paypalRequestId: requestId, prefer: 'return=representation' });
  createWire = wire(res);
  orderId = createWire.id;
  check('http status 201', res.statusCode === 201, `got ${res.statusCode}`);
  orderFields('create', createWire, { invoice: `${deal}-1` });
  check('SDK parsed result agrees (id, status)', res.result.id === createWire.id && String(res.result.status).length > 0);
} catch (e) {
  record('create order', 'FAIL', errorSummary(e));
}

section('approval link (Order.approval_url, table-proto order_approval_url)');
if (createWire) {
  const links: any[] = createWire.links ?? [];
  const approve = links.filter((l) => l.rel === 'approve' || l.rel === 'payer-action');
  check('exactly one approve|payer-action link', approve.length === 1, `rels: ${links.map((l) => l.rel).join(',')}`);
  const href = approve[0]?.href;
  let u: URL | undefined;
  try {
    u = new URL(href);
  } catch {
    /* handled below */
  }
  check('link is https on a sandbox paypal host, no port or userinfo', !!u && u.protocol === 'https:' && !u.port && !u.username && /^(www\.)?sandbox\.paypal\.com$/.test(u.hostname), `host ${u?.hostname}`);
  check('link path is /checkoutnow', u?.pathname === '/checkoutnow', `path ${u?.pathname}`);
  const q = u ? [...u.searchParams.entries()] : [];
  check('link has exactly one query pair token=<order id>', q.length === 1 && q[0][0] === 'token' && q[0][1] === orderId, `keys ${q.map(([k]) => k).join(',')}`);
}

section('idempotent create replay (PayPal-Request-Id, same key)');
if (orderId) {
  try {
    const again = await orders.createOrder({ body: createBody(1), paypalRequestId: requestId, prefer: 'return=representation' });
    check('replay under the same request id returns the SAME order id', wire(again).id === orderId);
  } catch (e) {
    record('create replay', 'FAIL', errorSummary(e));
  }
}

section('return destinations (create_order_returning: payment_source.paypal.experience_context)');
for (const [label, ret, cancel] of [
  ['loopback', 'http://127.0.0.1:49152/return', 'http://127.0.0.1:49152/cancel'],
  ['custom scheme', 'the-table://paypal/return', 'the-table://paypal/cancel'],
] as const) {
  try {
    const res = await orders.createOrder({
      body: { ...createBody(1), paymentSource: { paypal: { experienceContext: { returnUrl: ret, cancelUrl: cancel } } } },
      paypalRequestId: `${deal}-create-return-${label[0]}`,
      prefer: 'return=representation',
    });
    const w = wire(res);
    check(`${label}: order accepted at create (200 or 201)`, res.statusCode === 200 || res.statusCode === 201, `got ${res.statusCode}`);
    check(`${label}: still exactly one approve|payer-action link`, w.links.filter((l: any) => l.rel === 'approve' || l.rel === 'payer-action').length === 1);
  } catch (e) {
    record(`${label}: order accepted at create`, 'FAIL', errorSummary(e));
  }
}
record('return destination actually followed by the browser after approval', 'SKIP', 'needs the buyer; spike 5 observes it (loopback callback, OS prompt for the scheme)');

// ---- 2. read back --------------------------------------------------------------------------
section('read back (GET /v2/checkout/orders/{id})');
if (orderId) {
  try {
    const res = await orders.getOrder({ id: orderId });
    const o = wire(res);
    orderFields('get', o, { invoice: `${deal}-1` });
    check('get status is CREATED or PAYER_ACTION_REQUIRED (not yet approved)', ['CREATED', 'PAYER_ACTION_REQUIRED'].includes(o.status), `got ${o.status}`);
  } catch (e) {
    record('get order', 'FAIL', errorSummary(e));
  }
}

// ---- 3. what the sandbox answers without a buyer -------------------------------------------
section('authorize an UNAPPROVED order (the wallet never does this; recorded for the resolver)');
if (orderId) {
  try {
    await orders.authorizeOrder({ id: orderId, paypalRequestId: `${deal}-authorize-early`, prefer: 'return=representation' });
    record('authorize without approval is refused', 'FAIL', 'it succeeded');
  } catch (e) {
    const s = errorSummary(e);
    check('authorize without approval is refused with 422', s.startsWith('HTTP 422'), s);
  }
}
section('unknown authorization (void and capture error shape)');
for (const [what, run] of [
  ['GET authorization', () => payments.getAuthorizedPayment({ authorizationId: '0AA00000AA000000A' })],
  ['void', () => payments.voidPayment({ authorizationId: '0AA00000AA000000A', paypalRequestId: `${deal}-void-x` })],
] as const) {
  try {
    await run();
    record(`${what} of a never-issued id is refused`, 'FAIL', 'it succeeded');
  } catch (e) {
    const s = errorSummary(e);
    check(`${what} of a never-issued id is refused (4xx)`, /^HTTP 4\d\d/.test(s), s);
  }
}

// ---- 4. authorize, capture, void ------------------------------------------------------------
// Two routes to an authorized order, because the first needs a person:
//   wallet  (--approve)  the sandbox BUYER approves in a browser, exactly as the wallet's flow does;
//   card    (default)    the sandbox's public test card is passed as payment_source to authorize,
//                        which PayPal documents as the alternative to buyer approval
//                        (doc/controllers/orders.md "Authorize Order"). Everything after the
//                        authorization (capture, void, reads) is the same resource either way,
//                        but the buyer-approval status polling is NOT exercised by this route.
async function rawToken(): Promise<string> {
  const tok = await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${env.PAYPAL_SANDBOX_CLIENT_ID}:${env.PAYPAL_SANDBOX_SECRET}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  return ((await tok.json()) as any).access_token as string;
}
const TEST_CARD = { number: '4111111111111111', expiry: '2030-12', securityCode: '123', name: 'Conformance Buyer' };
async function settle(route: 'wallet' | 'card') {
  section(`authorize, capture, void (route: ${route === 'wallet' ? 'sandbox buyer approves in a browser' : 'sandbox test card, no browser'})`);
  const made: { id: string; invoice: string; link: string }[] = [];
  for (const attempt of [2, 3]) {
    const res = await orders.createOrder({ body: createBody(attempt), paypalRequestId: `${deal}-create-${attempt}`, prefer: 'return=representation' });
    const o = wire(res);
    made.push({ id: o.id, invoice: `${deal}-${attempt}`, link: o.links.find((l: any) => l.rel === 'approve' || l.rel === 'payer-action').href });
  }
  if (route === 'wallet') {
    console.log('  Open each link in a system browser, signed in as the sandbox BUYER (a different account), and approve.');
    console.log('  Links expire; polling lasts 10 minutes. Do not paste them anywhere.');
    made.forEach((m, i) => console.log(`  order ${i + 1} (${i === 0 ? 'capture' : 'void'} path): ${m.link}`));
    const approvedIds = new Set<string>();
    for (let i = 0; i < 120 && approvedIds.size < made.length; i++) {
      for (const m of made) {
        if (approvedIds.has(m.id)) continue;
        if (wire(await orders.getOrder({ id: m.id })).status === 'APPROVED') approvedIds.add(m.id);
      }
      if (approvedIds.size < made.length) await new Promise((r) => setTimeout(r, 5000));
    }
    if (approvedIds.size < made.length) {
      record('buyer approval within 10 minutes', 'FAIL', `${approvedIds.size}/${made.length} approved; nothing was authorized`);
      return;
    }
    check('buyer approval: both orders reach APPROVED (the status the wallet polls for)', true);
  }

  const [capOrder, voidOrder] = made;
  const auth: Record<string, string> = {};
  for (const m of made) {
    const tag = m.invoice.slice(-1);
    let res;
    try {
      res = await orders.authorizeOrder({
        id: m.id,
        paypalRequestId: `${deal}-authorize-${m.invoice}`,
        prefer: 'return=representation',
        body: route === 'card' ? { paymentSource: { card: TEST_CARD } } : undefined,
      });
    } catch (e) {
      record(`authorize order ${tag}`, 'FAIL', `${errorSummary(e)}${route === 'card' ? '; the sandbox account refuses card authorize, rerun with --approve' : ''}`);
      return;
    }
    const o = wire(res);
    check(`authorize ${tag} http status 201`, res.statusCode === 201, `got ${res.statusCode}`);
    orderFields(`authorize ${tag}`, o, { authorized: true, invoice: m.invoice });
    check(`authorize ${tag} order status COMPLETED`, o.status === 'COMPLETED', `got ${o.status}`);
    auth[m.id] = o.purchase_units[0].payments.authorizations[0].id;
  }
  const got = wire(await payments.getAuthorizedPayment({ authorizationId: auth[capOrder.id] }));
  check('GET authorization: id, status CREATED, amount', got.id === auth[capOrder.id] && got.status === 'CREATED' && money(got.amount), `status ${got.status}`);
  // capture with the exact body the Rust client sends (final_capture true), replayed under one key
  const capKey = `${deal}-capture`;
  const capBody = { amount: { currencyCode: 'USD', value: amountValue }, finalCapture: true };
  const cap = await payments.captureAuthorizedPayment({ authorizationId: auth[capOrder.id], paypalRequestId: capKey, prefer: 'return=representation', body: capBody });
  const cw = wire(cap);
  check('capture http status 201', cap.statusCode === 201, `got ${cap.statusCode}`);
  check('capture id', typeof cw.id === 'string' && RESOURCE.test(cw.id));
  check('capture status COMPLETED', cw.status === 'COMPLETED', `got ${cw.status}`);
  check('capture amount', money(cw.amount) && cw.amount.value === amountValue);
  // Reporting (reconciliation reads the capture id as transaction_id, status S, amount as a plain figure).
  try {
    const bearer = await rawToken();
    const end = new Date();
    const start = new Date(end.getTime() - 3 * 3600 * 1000);
    const iso = (d: Date) => d.toISOString().replace(/\.\d+Z$/, '+0000').replace('Z', '+0000');
    const url = `https://api-m.sandbox.paypal.com/v1/reporting/transactions?start_date=${encodeURIComponent(iso(start))}&end_date=${encodeURIComponent(iso(end))}&page=1&page_size=100&fields=transaction_info`;
    const rr = await fetch(url, { headers: { Authorization: `Bearer ${bearer}` } });
    const rj: any = await rr.json().catch(() => ({}));
    if (!rr.ok) {
      record('reporting: GET /v1/reporting/transactions', 'SKIP', `HTTP ${rr.status} ${rj.name ?? ''}: the app cannot read reporting (reconciliation.rs:63 stays unknown)`);
    } else {
      const row = (rj.transaction_details ?? []).find((d: any) => d.transaction_info?.transaction_id === cw.id);
      if (!row) record('reporting: the capture appears as transaction_id', 'SKIP', `not indexed yet (docs: up to 3 hours); ${rj.transaction_details?.length ?? 0} rows in window; fields page/total_pages ${rj.page}/${rj.total_pages}`);
      else {
        check('reporting: capture id is transaction_info.transaction_id', true);
        check('reporting: transaction_status S', row.transaction_info.transaction_status === 'S', `got ${row.transaction_info.transaction_status}`);
        check('reporting: seller-side transaction_amount is an unsigned figure', /^\d/.test(row.transaction_info.transaction_amount?.value ?? ''), `first char ${String(row.transaction_info.transaction_amount?.value ?? '?')[0]}`);
      }
    }
  } catch (e) {
    record('reporting probe', 'SKIP', errorSummary(e));
  }
  const replay = wire(await payments.captureAuthorizedPayment({ authorizationId: auth[capOrder.id], paypalRequestId: capKey, prefer: 'return=representation', body: capBody }));
  check('capture replay under the same PayPal-Request-Id returns the SAME capture id', replay.id === cw.id, `ids ${replay.id === cw.id ? 'equal' : 'differ'}`);
  const after = wire(await payments.getAuthorizedPayment({ authorizationId: auth[capOrder.id] }));
  check('GET authorization after capture is CAPTURED', after.status === 'CAPTURED', `got ${after.status}`);
  const orderAfter = wire(await orders.getOrder({ id: capOrder.id }));
  const caps = orderAfter.purchase_units?.[0]?.payments?.captures ?? [];
  check('GET order lists the capture under purchase_units[0].payments.captures', caps.some((c: any) => c.id === cw.id), `${caps.length} captures`);
  check('that capture entry carries amount and status COMPLETED', caps.some((c: any) => c.id === cw.id && money(c.amount) && c.status === 'COMPLETED'));
  // Control for spike 9 (opt-in: --refund-control). The capture above is for the app's OWN payee,
  // so this shows only that the app may refund its own account's capture and what the shape is.
  // Whether it may refund a capture made for ANOTHER payee is spike 9, which needs a second merchant.
  if (flag('--refund-control')) {
    const refundKey = `${deal}-refund`;
    try {
      const rf = await payments.refundCapturedPayment({ captureId: cw.id, paypalRequestId: refundKey, prefer: 'return=representation', body: { amount: { currencyCode: 'USD', value: amountValue } } });
      const rw = wire(rf);
      check('refund control: http status 201', rf.statusCode === 201, `got ${rf.statusCode}`);
      check('refund control: refund id present', typeof rw.id === 'string' && RESOURCE.test(rw.id));
      check('refund control: status COMPLETED', rw.status === 'COMPLETED', `got ${rw.status}`);
      const rep = wire(await payments.refundCapturedPayment({ captureId: cw.id, paypalRequestId: refundKey, prefer: 'return=representation', body: { amount: { currencyCode: 'USD', value: amountValue } } }));
      check('refund control: replay under the same PayPal-Request-Id returns the SAME refund id', rep.id === rw.id);
      const cg = wire(await payments.getCapturedPayment({ captureId: cw.id }));
      check('refund control: GET capture is REFUNDED', cg.status === 'REFUNDED', `got ${cg.status}`);
    } catch (e) {
      record('refund control (own payee)', 'FAIL', errorSummary(e));
    }
  }
  // void
  const voidKey = `${deal}-void`;
  const v = await payments.voidPayment({ authorizationId: auth[voidOrder.id], paypalRequestId: voidKey });
  check('void http status 204', v.statusCode === 204, `got ${v.statusCode}`);
  const vgot = wire(await payments.getAuthorizedPayment({ authorizationId: auth[voidOrder.id] }));
  check('GET authorization after void is VOIDED', vgot.status === 'VOIDED', `got ${vgot.status}`);
  try {
    const vr = await payments.voidPayment({ authorizationId: auth[voidOrder.id], paypalRequestId: voidKey });
    check('void replay under the same PayPal-Request-Id is accepted', vr.statusCode === 204 || vr.statusCode === 200, `got ${vr.statusCode}`);
  } catch (e) {
    record('void replay under the same PayPal-Request-Id is accepted', 'FAIL', errorSummary(e));
  }
  try {
    await payments.captureAuthorizedPayment({ authorizationId: auth[voidOrder.id], paypalRequestId: `${deal}-capture-voided`, body: capBody });
    record('capture of a VOIDED authorization is refused', 'FAIL', 'it succeeded');
  } catch (e) {
    check('capture of a VOIDED authorization is refused (4xx)', /^HTTP 4\d\d/.test(errorSummary(e)), errorSummary(e));
  }
}
try {
  await settle(flag('--approve') ? 'wallet' : 'card');
} catch (e) {
  record('authorize/capture/void stage', 'FAIL', errorSummary(e));
}

// ---- 5. invoicing: a DRAFT only (never sent, no money, no email) -----------------------------
// The SDK has no Invoicing controller in 2.5.0, so this part is a raw sandbox call: the shape of
// crates/table-paypal/src/secondary.rs InvoiceRequest::body, search_invoices and Invoice.
async function invoicing() {
  section('invoicing draft (raw HTTP: SDK 2.5.0 has no Invoicing controller)');
  const tok = await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${env.PAYPAL_SANDBOX_CLIENT_ID}:${env.PAYPAL_SANDBOX_SECRET}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const bearer = ((await tok.json()) as any).access_token as string;
  const call = (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) =>
    fetch(`https://api-m.sandbox.paypal.com${path}`, {
      method,
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const number = `R${deal.slice(-16)}-1`;
  const other = `R${deal.slice(-16)}-2`;
  const email = env.PAYPAL_SANDBOX_INVOICE_EMAIL || 'buyer@example.com';
  const body = (n: string) => ({
    detail: { currency_code: 'USD', reference: deal, invoice_number: n, note: 'Conformance draft; never sent.' },
    primary_recipients: [{ billing_info: { email_address: email } }],
    items: [{ name: 'Conformance draft item', quantity: '1', unit_amount: { currency_code: 'USD', value: amountValue } }],
  });
  const ids: string[] = [];
  try {
    const gen = await call('POST', '/v2/invoicing/generate-next-invoice-number', {});
    check('generate-next-invoice-number permitted for this app', gen.ok, `HTTP ${gen.status}`);
    const made: any[] = [];
    for (const n of [number, other]) {
      const res = await call('POST', '/v2/invoicing/invoices', body(n), { 'PayPal-Request-Id': `${deal}-invoice-${n.slice(-1)}` });
      const text = await res.text();
      let j: any = {};
      try { j = JSON.parse(text); } catch { /* handled by checks */ }
      made.push({ status: res.status, j });
      if (j.id) ids.push(j.id);
    }
    const first = made[0];
    check('create invoice http status 201', first.status === 201, `got ${first.status}`);
    check('create invoice (Prefer: return=representation) returns id', typeof first.j.id === 'string', `keys ${Object.keys(first.j).join(',')}`);
    check('create invoice returns status', typeof first.j.status === 'string', `got ${first.j.status}`);
    check('detail.invoice_number is accepted and echoed', first.j.detail?.invoice_number === number, first.j.detail?.invoice_number === number ? '' : 'differs or absent');
    check('detail.reference is echoed (Rust reads it)', first.j.detail?.reference === deal);
    check('detail.note accepted and stored', typeof first.j.detail?.note === 'string' && first.j.detail.note.length > 0);
    check('amount.value is the item total (Rust reads amount)', first.j.amount?.value === amountValue && first.j.amount?.currency_code === 'USD', `got ${first.j.amount?.value}`);
    const dup = await call('POST', '/v2/invoicing/invoices', body(number), { 'PayPal-Request-Id': `${deal}-invoice-dup` });
    check('a second invoice with the SAME invoice_number is refused (per-merchant uniqueness)', dup.status === 400 || dup.status === 422, `got HTTP ${dup.status}`);
    if (dup.ok) { const d: any = await dup.json().catch(() => ({})); if (d.id) ids.push(d.id); }
    for (const [len, accepted] of [[25, true], [26, false]] as const) {
      const n = ('X' + deal + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ').slice(0, len);
      const r = await call('POST', '/v2/invoicing/invoices', body(n), { 'PayPal-Request-Id': `${deal}-invoice-len${len}` });
      if (r.ok) { const d: any = await r.json().catch(() => ({})); if (d.id) ids.push(d.id); }
      check(`invoice_number of ${len} characters is ${accepted ? 'accepted' : 'refused'} (the Rust client caps at 25)`, r.ok === accepted, `HTTP ${r.status}`);
    }
    const s = await call('POST', '/v2/invoicing/search-invoices?page=1&page_size=10', { invoice_number: number });
    const sj: any = await s.json().catch(() => ({}));
    check('search-invoices accepts {"invoice_number": ...}', s.ok, `HTTP ${s.status}`);
    check('search response has an items array', Array.isArray(sj.items), `keys ${Object.keys(sj).join(',')}`);
    check('search by invoice_number finds the invoice by id', Array.isArray(sj.items) && sj.items.some((i: any) => i.id === first.j.id));
    check('search by invoice_number does NOT return the other invoice (the filter is applied, not ignored)', Array.isArray(sj.items) && !sj.items.some((i: any) => i.id === made[1].j.id), `${sj.items?.length ?? '?'} items`);
    const miss = await call('POST', '/v2/invoicing/search-invoices?page=1&page_size=10', { invoice_number: 'R0000000000000000-9' });
    const mj: any = await miss.json().catch(() => ({}));
    check('search for an unused number returns zero items', miss.ok && Array.isArray(mj.items) ? mj.items.length === 0 : miss.ok && (mj.items === undefined), `HTTP ${miss.status}, items ${mj.items?.length ?? 'absent'}`);
    const g = await call('GET', `/v2/invoicing/invoices/${first.j.id}`);
    const gj: any = await g.json().catch(() => ({}));
    check('GET invoice: id, status, detail.invoice_number, amount', g.ok && gj.id === first.j.id && typeof gj.status === 'string' && gj.detail?.invoice_number === number && !!gj.amount, `status ${gj.status}`);
  } finally {
    for (const id of ids) await call('DELETE', `/v2/invoicing/invoices/${id}`).catch(() => undefined);
    console.log(`  (cleanup: ${ids.length} draft invoice(s) deleted)`);
  }
}
try {
  await invoicing();
} catch (e) {
  record('invoicing draft stage', 'FAIL', errorSummary(e));
}

// ---- 6. subscription read (billing_info), a never-approved subscription -----------------------
// A failed renewal cannot be produced on demand, so this proves only what a fresh subscription
// shows: the endpoint, that `fields=last_failed_payment` is accepted, and which billing_info keys
// exist before any payment. The failure-path fields are checked against the SDK model docs.
async function subscriptionShape() {
  section('subscription read (raw HTTP: the SDK has no catalog controller, and the shape is read off the wire)');
  const bearer = await rawToken();
  const raw = (method: string, path: string, body?: unknown) =>
    fetch(`https://api-m.sandbox.paypal.com${path}`, {
      method,
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', Prefer: 'return=representation', 'PayPal-Request-Id': randomUUID() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const prod = await raw('POST', '/v1/catalogs/products', { name: `Conformance ${deal}`, type: 'SERVICE' });
  if (!prod.ok) {
    record('catalog product for a probe plan', 'SKIP', `HTTP ${prod.status}: no subscription probe possible`);
    return;
  }
  const productId = ((await prod.json()) as any).id;
  const plan = await raw('POST', '/v1/billing/plans', {
    product_id: productId,
    name: `Conformance plan ${deal}`,
    billing_cycles: [{ frequency: { interval_unit: 'MONTH', interval_count: 1 }, tenure_type: 'REGULAR', sequence: 1, total_cycles: 0, pricing_scheme: { fixed_price: { value: '1.25', currency_code: 'USD' } } }],
    payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 3 },
  });
  if (!plan.ok) {
    record('billing plan for a probe subscription', 'SKIP', `HTTP ${plan.status}`);
    return;
  }
  const planId = ((await plan.json()) as any).id;
  const sub = await raw('POST', '/v1/billing/subscriptions', { plan_id: planId, application_context: { return_url: 'https://example.com/return', cancel_url: 'https://example.com/cancel' } });
  if (!sub.ok) {
    record('subscription (APPROVAL_PENDING) for the probe', 'SKIP', `HTTP ${sub.status}`);
    return;
  }
  const subId = ((await sub.json()) as any).id;
  const got = await raw('GET', `/v1/billing/subscriptions/${subId}?fields=last_failed_payment`);
  const gj: any = await got.json().catch(() => ({}));
  check('GET subscription with ?fields=last_failed_payment is accepted', got.ok, `HTTP ${got.status}`);
  check('subscription id, status, plan_id present', gj.id === subId && typeof gj.status === 'string' && gj.plan_id === planId, `status ${gj.status}`);
  const bi = gj.billing_info;
  record('billing_info on a never-approved subscription', bi ? 'PASS' : 'SKIP', bi ? `keys ${Object.keys(bi).join(',')}` : 'absent (docs: populated once the subscription was or is active); the Rust field is Option');
  record('failed_payments_count / outstanding_balance / last_failed_payment values', 'SKIP', 'need a real failed renewal, which a sandbox cannot be asked for; names are from the SDK model docs');
  // tidy: cancel the probe subscription (never approved, so nothing was ever billed)
  await raw('POST', `/v1/billing/subscriptions/${subId}/cancel`, { reason: 'conformance probe finished' }).catch(() => undefined);
}
try {
  await subscriptionShape();
} catch (e) {
  record('subscription probe', 'SKIP', errorSummary(e));
}

// ---- summary -------------------------------------------------------------------------------
const count = (v: Verdict) => results.filter((r) => r.verdict === v).length;
console.log(`\nSUMMARY: ${count('PASS')} pass, ${count('FAIL')} fail, ${count('SKIP')} skip  (env names read: ${need.join(', ')}; file not printed)`);
process.exit(count('FAIL') > 0 ? 1 : 0);
