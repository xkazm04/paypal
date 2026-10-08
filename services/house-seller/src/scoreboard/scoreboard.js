// The house seller's public record, read from this origin's public routes and checked here.
// Read-only: it fetches GET /v1/house/ledger and nothing else, sends nothing, and builds every
// line with textContent (the record holds no free text, and none could run here anyway).
// The signature checks use the browser's own Ed25519 and SHA-256; a browser without Ed25519
// says so instead of passing them. The same checks run offline in the project's checker.
(() => {
  'use strict';

  const HEAD_DOMAIN = 'table.house.head.v1';
  const PAGE = 100;
  const REFRESH_MS = 60_000;
  const HEADS_KEY = 'table-house-heads';
  const THEME_KEY = 'table-house-theme';
  const EXPONENT = { JPY: 0, KWD: 3, BHD: 3 };
  const SYMBOL = { USD: '$', EUR: '€', GBP: '£' };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /** Deal states in the wallet's words, from the house seller's side. */
  const STATE = {
    PAIRING: ['Connecting', 'live'], LISTED: ['Listed', 'live'], NEGOTIATING: ['Negotiating', 'live'],
    AGREED: ['Agreed', 'live'], SETTLING: ['Preparing payment', 'live'],
    AWAITING_APPROVAL: ['Waiting for buyer', 'wait'], APPROVED: ['Approved on PayPal', 'wait'],
    AUTHORIZED: ['On hold', 'held'], CAPTURED: ['Paid', 'done'], RECEIPTED: ['Paid, receipt saved', 'done'],
    RECONCILED: ['Paid, on statement', 'done'], WITHDRAWN: ['Withdrawn', 'off'], EXPIRED: ['Expired', 'off'],
    VOIDED: ['Hold released', 'off'], AUTO_VOIDED: ['Hold released', 'off'], REFUSED: ['Refused', 'bad'],
    MISMATCH: ['Amount didn’t match', 'bad'], FAILED: ['Failed', 'bad'], REFUNDED: ['Refunded', 'off'],
    DISPUTED: ['Disputed', 'bad'],
  };
  const NOT_AGREED = new Set(['PAIRING', 'LISTED', 'NEGOTIATING', 'WITHDRAWN', 'REFUSED']);
  const PAID = new Set(['CAPTURED', 'RECEIPTED', 'RECONCILED']);

  const $ = (id) => document.getElementById(id);
  /** A DOM node from a tag, attributes and children (strings become text nodes). */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
    return el;
  }
  const svg = (path) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', path);
    s.append(p);
    return s;
  };
  const ICON = { ok: 'M5 12.5l4.5 4.5L19 7.5', bad: 'M7 7l10 10M17 7L7 17', note: 'M12 7v6M12 17h.01' };

  // ---- formatting ---------------------------------------------------------------------------

  /** "$12.00": exact string arithmetic on the integer minor units, never a float. */
  function money(m) {
    if (!m) return '—';
    const exp = EXPONENT[m.currency] ?? 2;
    const digits = Math.abs(Math.trunc(m.minor)).toString().padStart(exp + 1, '0');
    const whole = (exp ? digits.slice(0, -exp) : digits).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const body = exp ? `${whole}.${digits.slice(-exp)}` : whole;
    const text = SYMBOL[m.currency] ? `${SYMBOL[m.currency]}${body}` : `${body} ${m.currency}`;
    return m.minor < 0 ? `−${text}` : text;
  }
  const hex = (bytes) => (bytes || []).map((b) => b.toString(16).padStart(2, '0')).join('');
  /** The wallet's short form of a digest: "7c1e…94". */
  const shortHash = (bytes) => { const x = hex(bytes); return x ? `${x.slice(0, 4)}…${x.slice(-2)}` : '—'; };
  /** The wallet's short form of a deal number: "01M4CE…GFAE". */
  const shortId = (id) => (id.length <= 11 ? id : `${id.slice(0, 6)}…${id.slice(-4)}`);
  const pad = (n) => String(n).padStart(2, '0');
  function when(seconds) {
    const d = new Date(seconds * 1000);
    const now = new Date();
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (d.toDateString() === now.toDateString()) return `today ${hm}`;
    return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`} ${hm}`;
  }
  function day(seconds) {
    const d = new Date(seconds * 1000);
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }
  /** Percent with one decimal from basis points (an integer). */
  const percent = (bp) => `${Math.trunc(bp / 100)}.${Math.trunc(Math.abs(bp) % 100 / 10)}%`;
  /** Discount off the ask in basis points; null when not comparable. */
  function discount(d) {
    if (d.ask.currency !== d.price.currency || d.ask.minor <= 0) return null;
    return Math.trunc(((d.ask.minor - d.price.minor) * 10000) / d.ask.minor);
  }
  const agreed = (d) => d.closed.length > 0 || !NOT_AGREED.has(d.state);

  // ---- canonical bytes and signatures ---------------------------------------------------------

  /** RFC 8785 canonical JSON for the record's values (integers, strings, arrays, objects). */
  function canonical(v) {
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    if (v && typeof v === 'object') {
      return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
    }
    return JSON.stringify(v);
  }
  const utf8 = (s) => new TextEncoder().encode(s);
  const bytes = (a) => new Uint8Array(a);
  async function sha256(data) {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
  }
  let ed25519 = null;
  /** True when this browser can check Ed25519 signatures. */
  async function canVerify() {
    if (ed25519 !== null) return ed25519;
    try {
      if (!globalThis.crypto || !crypto.subtle) throw new Error('no subtle crypto');
      await crypto.subtle.importKey('raw', new Uint8Array(32).fill(1), { name: 'Ed25519' }, false, ['verify']);
      ed25519 = true;
    } catch {
      ed25519 = false;
    }
    return ed25519;
  }
  async function verify(key, signature, data) {
    try {
      const k = await crypto.subtle.importKey('raw', bytes(key), { name: 'Ed25519' }, false, ['verify']);
      return await crypto.subtle.verify({ name: 'Ed25519' }, k, bytes(signature), data);
    } catch {
      return false;
    }
  }

  // ---- the checks (the same rules as the offline checker) -------------------------------------

  const ok = (title, detail) => ({ state: 'ok', title, detail });
  const bad = (title, detail) => ({ state: 'bad', title, detail });
  const unknown = (title, detail) => ({ state: 'unknown', title, detail });
  const note = (title, detail) => ({ state: 'note', title, detail });
  const NO_ED25519 = 'This browser can’t check signatures. The offline check below can.';

  async function checkRules(view, crypto) {
    const t = 'The rules are the ones its owner signed';
    const { release, mandate } = view;
    if (!crypto) return { result: unknown(t, NO_ED25519), mandateHash: null };
    const mandateHash = await sha256(utf8(canonical(mandate.payload)));
    const pinned = await verify(release.owner_key, release.owner_signature, bytes(release.mandate_commitment));
    const committed = hex(mandateHash) === hex(release.mandate_commitment) && hex(mandate.payload.agent_key) === hex(release.agent_key);
    const signed = await verify(release.owner_key, mandate.owner_sig, utf8(canonical(mandate.payload)));
    if (!(pinned && committed && signed)) return { result: bad(t, 'The rules shown are not the ones the owner’s key signed.'), mandateHash };
    return { result: ok(t, `Signed by the owner’s key ${hex(release.owner_key).slice(0, 12)}…`), mandateHash };
  }

  async function checkHead(view, crypto) {
    const t = 'The record is signed by the house’s key';
    if (!crypto) return unknown(t, NO_ED25519);
    const head = view.head.head;
    const good = head.row_count > 0 && head.at >= head.epoch_started
      && await verify(view.release.agent_key, view.head.signature, utf8(canonical([HEAD_DOMAIN, head])));
    if (!good) return bad(t, 'The record’s signature does not match the house’s key.');
    const last = Math.max(0, ...deals.flatMap((d) => d.money.map((m) => m.seq)));
    if (last > head.row_count) return bad(t, `A payment step cites entry ${last}, past the signed ${head.row_count}.`);
    return ok(t, `${head.row_count} entries, signed ${when(head.at)}.`);
  }

  function floorOf(view) {
    for (const c of view.mandate.payload.clauses) {
      if (c.type === 'band' && c.floor && c.item_refs.length === 1) return c.floor;
    }
    return null;
  }
  function checkFloor(view) {
    const floor = floorOf(view);
    const t = 'Never sold below the least it accepts';
    if (!floor) return bad(t, 'The signed rules name no lowest price.');
    const below = (m) => m.currency !== floor.currency || m.minor < floor.minor;
    for (const d of deals) {
      const r = d.rounds.find((x) => x.from === 'house' && (x.kind === 'counter' || x.kind === 'accept') && x.price && below(x.price));
      if (r) return bad(t, `Deal ${shortId(d.deal_id)}: the house offered ${money(r.price)}, below ${money(floor)}.`);
      if (agreed(d) && below(d.price)) return bad(t, `Deal ${shortId(d.deal_id)}: agreed ${money(d.price)}, below ${money(floor)}.`);
      if (d.closed.some((c) => below(c.amount))) return bad(t, `Deal ${shortId(d.deal_id)}: approved below ${money(floor)}.`);
    }
    const n = deals.filter((d) => d.closed.length).length;
    return ok(t, `Least it accepts: ${money(floor)}. ${n} agreed deal${n === 1 ? '' : 's'}, none below.`);
  }

  function checkOrder() {
    const t = 'Paid only after the buyer approved on PayPal and the money was on hold';
    let paid = 0;
    for (const d of deals) {
      const first = (kind) => Math.min(...d.money.filter((m) => m.step === kind && m.outcome === 'ok').map((m) => m.seq));
      for (const m of d.money) {
        const before = (kind) => first(kind) < m.seq;
        const lawful = m.step === 'create' || m.step === 'void'
          || (m.step === 'approval_seen' && before('create'))
          || (m.step === 'authorize' && before('approval_seen') && before('create'))
          || (m.step === 'capture' && before('authorize') && before('approval_seen'));
        if (!lawful) return bad(t, `Deal ${shortId(d.deal_id)}: a payment step came before the steps that must come first.`);
        if (m.step === 'capture' && m.outcome === 'ok') paid += 1;
      }
    }
    return ok(t, `${paid} payment${paid === 1 ? '' : 's'} collected, each after the buyer’s approval and a hold.`);
  }

  function checkAuthority(view, mandateHash) {
    const t = 'Every payment step under the owner’s signed rules';
    if (!mandateHash) return unknown(t, NO_ED25519);
    const m = hex(mandateHash);
    for (const d of deals) {
      for (const s of d.money) {
        const by = s.decided_by;
        const lawful = (by === null && s.step === 'approval_seen')
          || (by && by.type === 'safe_default' && s.step === 'void')
          || (by && by.type === 'house_mandate' && hex(by.mandate_hash) === m && s.step !== 'approval_seen');
        if (!lawful) return bad(t, `Deal ${shortId(d.deal_id)}: a payment step has no signed rule behind it.`);
      }
      for (const c of d.closed) {
        if (hex(c.open_mandate_hash) !== m || c.decided_by.type !== 'house_mandate' || hex(c.decided_by.mandate_hash) !== m) {
          return bad(t, `Deal ${shortId(d.deal_id)}: an approval is not under the signed rules.`);
        }
      }
    }
    return ok(t, 'Or a hold released by itself on its deadline. Nothing else can move money.');
  }

  function checkQuiet(view) {
    const t = 'No PayPal call without an agreed deal';
    let quiet = 0;
    for (const d of deals) {
      if (d.closed.length) continue;
      if (d.paypal_calls !== 0 || d.money.length) return bad(t, `Deal ${shortId(d.deal_id)}: PayPal was called before the deal was agreed.`);
      quiet += 1;
    }
    const r = refusals(view);
    return ok(t, `${quiet} unagreed deal${quiet === 1 ? '' : 's'} and ${r} refusal${r === 1 ? '' : 's'}: 0 PayPal calls.`);
  }

  function checkPrivate() {
    const t = 'Buyers shown only by the start of their key';
    const leak = deals.find((d) => d.guest.length > 12 || !/^[0-9a-f]*$/i.test(d.guest));
    return leak ? bad(t, `Deal ${shortId(leak.deal_id)} shows more than a key prefix.`) : ok(t, 'No names, no messages, no PayPal account details.');
  }

  /** Heads this browser has seen: never shorter within one record, one hash per length. */
  function checkHeads(view, signedOk) {
    const t = 'The record never got shorter';
    const head = view.head.head;
    const seen = loadHeads();
    const cur = { epoch: hex(head.epoch), rows: head.row_count, hash: hex(head.audit_head), at: head.at, started: head.epoch_started };
    for (const s of seen) {
      if (s.epoch !== cur.epoch) continue;
      if (cur.rows < s.rows && cur.at > s.at) return bad(t, `It had ${s.rows} entries at ${when(s.at)}, now ${cur.rows}.`);
      if (cur.rows === s.rows && cur.hash !== s.hash) return bad(t, `Two different records were signed at ${cur.rows} entries.`);
    }
    if (signedOk) saveHeads(seen, cur);
    const earlier = seen.filter((s) => s.epoch !== cur.epoch);
    if (earlier.length) {
      return note(t, `The house started a new record on ${day(cur.started)}, for example after its storage was replaced. Deals before then are not in this one.`);
    }
    const looks = seen.filter((s) => s.epoch === cur.epoch).length;
    return ok(t, looks ? `Checked against ${looks} earlier look${looks === 1 ? '' : 's'} from this browser.` : `Record started ${day(cur.started)}. This browser keeps each look to compare.`);
  }
  function loadHeads() {
    try {
      const v = JSON.parse(localStorage.getItem(HEADS_KEY) || '[]');
      return Array.isArray(v) ? v.filter((s) => s && typeof s.epoch === 'string' && Number.isInteger(s.rows)) : [];
    } catch {
      return [];
    }
  }
  function saveHeads(seen, cur) {
    try {
      if (seen.some((s) => s.epoch === cur.epoch && s.rows === cur.rows && s.hash === cur.hash)) return;
      localStorage.setItem(HEADS_KEY, JSON.stringify([...seen, cur].slice(-200)));
    } catch {
      /* private mode: compare within this visit only */
    }
  }

  const refusals = (view) => {
    const r = view.refusals;
    return r.daily_limit + r.full + r.other + deals.reduce((n, d) => n + d.refused_intents, 0);
  };

  // ---- state and rendering ---------------------------------------------------------------------

  let view = null;
  let deals = [];
  let more = false;
  let open = null;
  let lastOk = 0;

  function renderTiles() {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const since = midnight.getTime() / 1000;
    const today = deals.filter((d) => d.created_at >= since);
    const capped = more && deals.length && deals[deals.length - 1].created_at >= since;
    for (const id of ['t-today', 't-refused', 't-rows']) $(id).className = 't-v';
    $('t-today').textContent = `${today.length}${capped ? '+' : ''}`;
    const paid = today.filter((d) => PAID.has(d.state)).length;
    $('t-today-s').textContent = today.length ? `${paid} paid` : 'None yet today';

    const offs = deals.filter((d) => d.closed.length).map(discount).filter((x) => x !== null).sort((a, b) => a - b);
    const tile = $('t-discount');
    if (offs.length) {
      const mid = offs.length % 2 ? offs[(offs.length - 1) / 2] : Math.trunc((offs[offs.length / 2 - 1] + offs[offs.length / 2]) / 2);
      tile.textContent = percent(mid);
      tile.className = 't-v';
      $('t-discount-s').textContent = `Middle of ${offs.length} agreed deal${offs.length === 1 ? '' : 's'}`;
    } else {
      tile.textContent = 'No deals yet';
      tile.className = 't-v unknown';
      $('t-discount-s').textContent = 'Shown once a deal is agreed';
    }

    $('t-refused').textContent = String(refusals(view));
    const s = $('t-refused-s');
    s.replaceChildren(h('b', null, '0 PayPal calls'), ` · since ${day(view.refusals.since).replace(/ \d{4}$/, '')}`);

    const head = view.head.head;
    $('t-rows').textContent = head.row_count.toLocaleString('en-US');
    $('t-rows-s').textContent = `Signed ${when(head.at)}`;
  }

  async function renderChecks() {
    const crypto = await canVerify();
    const rules = await checkRules(view, crypto);
    const headCheck = await checkHead(view, crypto);
    const checks = [
      rules.result,
      headCheck,
      checkHeads(view, headCheck.state !== 'bad'),
      checkFloor(view),
      checkOrder(),
      checkAuthority(view, rules.mandateHash),
      checkQuiet(view),
      checkPrivate(),
    ];
    $('checks').replaceChildren(...checks.map((c) => h('li', { class: `check ${c.state}` },
      h('span', { class: 'ck-i', 'aria-label': { ok: 'Passed', bad: 'Failed', note: 'Note', unknown: 'Not checked here' }[c.state] }, c.state === 'unknown' ? null : svg(ICON[c.state])),
      h('span', { class: 'ck-t' }, c.title),
      h('span', { class: 'ck-d' }, c.detail))));
    const failed = checks.filter((c) => c.state === 'bad').length;
    const skipped = checks.filter((c) => c.state === 'unknown').length;
    const v = $('verdict');
    v.className = `verdict ${failed ? 'bad' : skipped ? 'wait' : 'ok'}`;
    v.textContent = failed ? `${failed} check${failed === 1 ? '' : 's'} failed`
      : skipped ? `${checks.length - skipped} of ${checks.length} passed · ${skipped} need the offline check`
      : `All ${checks.length} passed over ${deals.length} deal${deals.length === 1 ? '' : 's'}`;
  }

  /** Four PayPal steps: created, buyer approved, on hold (or released), paid. */
  function steps(d) {
    if (!d.money.length) {
      return h('span', { class: 'steps', title: 'Nothing was sent to PayPal' }, h('span', { class: 'none' }, d.closed.length ? 'Not sent yet' : 'None'));
    }
    const of = (kind) => {
      const all = d.money.filter((m) => m.step === kind);
      if (all.some((m) => m.outcome === 'ok')) return 'ok';
      if (all.some((m) => m.outcome === 'unknown')) return 'unk';
      if (all.some((m) => m.outcome === 'failed')) return 'fail';
      return '';
    };
    const voided = of('void') === 'ok';
    const parts = [
      ['Order created', of('create')],
      ['Buyer approved on PayPal', of('approval_seen')],
      [voided ? 'Hold released' : 'On hold at PayPal', voided ? 'void' : of('authorize')],
      ['Paid', of('capture') === 'ok' ? 'ok paid' : of('capture')],
    ];
    const label = parts.map(([n, s]) => `${n}: ${s.startsWith('ok') || s === 'void' ? 'yes' : s === 'unk' ? 'checking with PayPal' : s === 'fail' ? 'refused by PayPal' : 'not yet'}`).join(' · ');
    return h('span', { class: 'steps', title: label, 'aria-label': label }, parts.map(([, s]) => h('i', { class: s })));
  }

  const ROUND = { listing: 'Asks', offer: 'Offers', counter: 'Counters', accept: 'Accepts', withdraw: 'Walks away' };
  const STEP = { create: 'Order created at PayPal', approval_seen: 'Buyer approved on PayPal', authorize: 'Money put on hold', capture: 'Payment collected', void: 'Hold released' };
  const OUTCOME = { ok: '', failed: ' · PayPal refused it', unknown: ' · checking with PayPal' };
  function authority(by) {
    if (!by) return 'seen on PayPal';
    if (by.type === 'house_mandate') return 'under the owner’s signed rules';
    if (by.type === 'safe_default') return 'released by itself on its deadline';
    return 'another authority';
  }
  function copyButton(text, what) {
    return h('button', {
      type: 'button', class: 'copy', 'aria-label': `Copy the ${what}`,
      onclick: async (e) => {
        e.stopPropagation();
        try { await navigator.clipboard.writeText(text); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Select and copy'; }
        setTimeout(() => { e.target.textContent = 'Copy'; }, 1600);
      },
    }, 'Copy');
  }
  function detail(d) {
    const haggle = h('ol', { class: 'tl' }, d.rounds.map((r) => h('li', null,
      h('span', { class: `who ${r.from}` }, r.from === 'house' ? 'House' : 'Buyer'),
      h('span', null, `${ROUND[r.kind] || r.kind}${r.round ? ` · round ${r.round}` : ''}`, r.declined ? h('span', { class: 'by' }, ' · outside its price range, not taken') : null),
      h('span', { class: `price ${r.declined ? 'declined' : ''}` }, r.price ? money(r.price) : ''))));
    const pay = d.money.length
      ? h('ol', { class: 'tl pay' }, d.money.map((m) => h('li', null,
        h('span', { class: 'by' }, when(m.at).replace('today ', '')),
        h('span', null, `${STEP[m.step]}${OUTCOME[m.outcome]}`),
        h('span', { class: 'by' }, authority(m.decided_by)))))
      : h('p', { class: 'small' }, d.closed.length ? 'Agreed; nothing sent to PayPal yet.' : 'Never agreed, so nothing was sent to PayPal.');
    const mark = hex(d.transcript_head);
    return h('div', { class: 'dd' },
      h('div', null, h('h3', null, 'The haggle, as both sides signed it'), haggle),
      h('div', null, h('h3', null, 'PayPal'), pay,
        h('dl', { class: 'kv' },
          h('dt', null, 'Deal number'), h('dd', null, h('span', { class: 'mono' }, d.deal_id), copyButton(d.deal_id, 'deal number')),
          h('dt', null, 'Record mark'), h('dd', null, h('span', { class: 'mono', title: mark }, shortHash(d.transcript_head)), ' · your wallet shows the same mark in this deal’s record'),
          d.closed.length ? [h('dt', null, 'Approved'), h('dd', null, `${money(d.closed[d.closed.length - 1].amount)} under the signed rules · `, h('span', { class: 'mono' }, shortHash(d.closed[d.closed.length - 1].hash)))] : null,
          h('dt', null, 'PayPal calls'), h('dd', null, String(d.paypal_calls)),
          d.refused_intents ? [h('dt', null, 'Stopped by the rules'), h('dd', null, `${d.refused_intents} time${d.refused_intents === 1 ? '' : 's'}, none reached PayPal`)] : null)));
  }

  function matches(d, q) {
    if (!q) return false;
    const mark = hex(d.transcript_head);
    const id = d.deal_id.toLowerCase();
    const short = q.split('…');
    if (short.length === 2 && short[0] && short[1]) {
      return (id.startsWith(short[0]) && id.endsWith(short[1])) || (mark.startsWith(short[0]) && mark.endsWith(short[1]));
    }
    return id.includes(q) || (q.length >= 4 && mark.startsWith(q));
  }
  function renderRows() {
    const q = $('find').value.trim().toLowerCase().replace(/\.\.\./g, '…').replace(/\s+/g, '');
    const hits = q ? deals.filter((d) => matches(d, q)) : deals;
    if (q && hits.length === 1) open = hits[0].deal_id;
    const body = $('rows');
    if (!hits.length) {
      body.replaceChildren(h('tr', { class: 'empty' }, h('td', { colspan: 9 },
        q ? (more ? 'Not among the deals shown. Show older deals to look further.' : 'No deal with that number or mark.') : 'No deals yet. The first one shows here within a minute.')));
    } else {
      body.replaceChildren(...hits.flatMap((d) => {
        const [word, tone] = STATE[d.state] || [d.state, 'off'];
        const off = agreed(d) ? discount(d) : null;
        const isOpen = open === d.deal_id;
        const toggle = () => { open = isOpen ? null : d.deal_id; renderRows(); };
        const row = h('tr', {
          class: `row${isOpen ? ' open' : ''}${q ? ' hit' : ''}`, tabindex: 0, 'aria-expanded': String(isOpen),
          onclick: toggle, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } },
        },
          h('td', { class: 'when' }, when(d.created_at)),
          h('td', null, h('span', { class: 'deal-id', title: d.deal_id }, shortId(d.deal_id))),
          h('td', { class: 'item', title: d.item_ref }, d.item_ref),
          h('td', { class: 'num' }, money(d.ask)),
          h('td', { class: 'num' }, agreed(d) ? h('b', null, money(d.price)) : h('span', { class: 'dim' }, '—')),
          h('td', { class: 'num' }, off !== null && off > 0 ? h('span', { class: 'off' }, `−${percent(off)}`) : h('span', { class: 'dim' }, off === 0 ? 'asking' : '—')),
          h('td', null, h('span', { class: `chip ${tone}` }, word)),
          h('td', null, steps(d)),
          h('td', { class: 'buyer', title: 'The start of the buyer’s key' }, `${d.guest}…`));
        return isOpen ? [row, h('tr', { class: 'detail' }, h('td', { colspan: 9 }, detail(d)))] : [row];
      }));
    }
    $('older').hidden = !more;
    $('older').parentElement.hidden = !more;
  }

  function renderKeys() {
    const k = $('keys');
    k.replaceChildren(
      h('dt', null, 'House key'), h('dd', null, hex(view.release.agent_key)),
      h('dt', null, 'Owner key'), h('dd', null, hex(view.release.owner_key)),
      h('dt', null, 'Signed rules'), h('dd', null, hex(view.release.mandate_commitment)),
      h('dt', null, 'Record started'), h('dd', null, `${day(view.head.head.epoch_started)} · ${hex(view.head.head.epoch).slice(0, 16)}…`));
  }

  function fresh(text, live) {
    const f = $('fresh');
    f.className = `fresh${live ? '' : ' stale'}`;
    f.replaceChildren(h('span', { class: 'live', 'aria-hidden': 'true' }), text);
  }

  async function fetchPage(before) {
    const url = `/v1/house/ledger?limit=${PAGE}${before ? `&before=${encodeURIComponent(before)}` : ''}`;
    const r = await fetch(url, { cache: 'no-store', credentials: 'omit' });
    if (!r.ok) throw Object.assign(new Error('unavailable'), { status: r.status });
    const v = await r.json();
    if (v.format !== 'table.house.ledger.v1') throw new Error('format');
    return v;
  }

  async function load() {
    try {
      const v = await fetchPage(null);
      const newest = new Set(v.deals.map((d) => d.deal_id));
      const oldest = v.deals.length ? v.deals[v.deals.length - 1].deal_id : null;
      // Keep older pages already shown; the newest page replaces its own range.
      const kept = deals.filter((d) => !newest.has(d.deal_id) && oldest && d.deal_id < oldest);
      more = kept.length ? more : v.more;
      deals = [...v.deals, ...kept];
      view = v;
      lastOk = Date.now();
      fresh(`Live · signed ${when(v.head.head.at)}`, true);
      renderTiles();
      renderRows();
      renderKeys();
      await renderChecks();
    } catch (e) {
      if (!view) {
        const starting = e && e.status === 503;
        $('rows').replaceChildren(h('tr', { class: 'empty' }, h('td', { colspan: 9 },
          starting ? 'The house is starting. Its record shows here in a minute.' : 'Couldn’t reach the house. Trying again in a minute.')));
        $('checks').replaceChildren(h('li', { class: 'check unknown' }, h('span', { class: 'ck-i' }), h('span', { class: 'ck-t' }, 'Waiting for the record'), h('span', { class: 'ck-d' }, 'Nothing is checked until the house answers.')));
        fresh(starting ? 'Starting…' : 'Not reachable', false);
      } else {
        fresh(`Couldn’t refresh · showing ${new Date(lastOk).toTimeString().slice(0, 5)}`, false);
      }
    }
  }

  async function older() {
    if (!deals.length) return;
    const btn = $('older');
    btn.disabled = true;
    btn.textContent = 'Loading…';
    try {
      const v = await fetchPage(deals[deals.length - 1].deal_id);
      const have = new Set(deals.map((d) => d.deal_id));
      deals = [...deals, ...v.deals.filter((d) => !have.has(d.deal_id))];
      more = v.more;
      renderTiles();
      renderRows();
      await renderChecks();
    } catch {
      /* the button stays; the next try may work */
    } finally {
      btn.disabled = false;
      btn.textContent = 'Show older deals';
    }
  }

  // ---- theme ----------------------------------------------------------------------------------

  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }
  function storedTheme() {
    try { return localStorage.getItem(THEME_KEY); } catch { return null; }
  }
  applyTheme(storedTheme());

  document.addEventListener('DOMContentLoaded', () => {
    $('theme').addEventListener('click', () => {
      const dark = getComputedStyle(document.documentElement).colorScheme.includes('dark');
      const next = dark ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch { /* not remembered */ }
    });
    $('find').addEventListener('input', () => { if (view) renderRows(); });
    $('older').addEventListener('click', () => { void older(); });
    void load();
    setInterval(() => { if (!document.hidden) void load(); }, REFRESH_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastOk > REFRESH_MS) void load(); });
  });
})();
