/* SANDBOX SAMPLE DATA — derived from the design report "The Table".
   Maya, Dan, Second Screen and every counterparty are fictional.
   Snapshot moment: Thu 29 Oct 2026, 14:02 local (the week of Mon 26 Oct – Sun 1 Nov).
   Every amount is USD in the PayPal sandbox. Nothing here is a real transaction. */
window.FIX = {
  mode: 'SANDBOX',
  nowISO: '2026-10-29T14:02:00',
  owner: {
    name: 'Maya', shop: 'Second Screen',
    line: 'a two-person shop selling refurbished monitors and a $12/month care plan',
    paypal: 'sandbox business account · second-screen-biz (fictional)',
    engine: 'claude-code'
  },

  mandates: [
    { id: 'M-12', v: 3, kind: 'open', status: 'active', agentKey: '9f3c…a1', commitment: '51d0…e2',
      signed: 'Mon 26 Oct 08:40',
      clauses: [
        { n: 1, name: 'Roles', text: 'Buy · Sell · Shop · Rescue' },
        { n: 2, name: 'Counterparties', text: 'paired (words confirmed) or HOUSE only' },
        { n: 3, name: 'Per deal', text: 'purchase: max $200 per deal · categories [office, parts, packing]' },
        { n: 4, name: 'Band', text: 'monitor-27-4k · ceiling $340 · 6 rounds · until 18:00 today' },
        { n: 5, name: 'Velocity', text: 'max 12 deals/day · max $900/day' },
        { n: 6, name: 'Human present over', text: 'ask me above $250' },
        { n: 7, name: 'Payees', text: 'allowlist: packrite-supply, cablehaus, north-desk, HOUSE' }
      ],
      prev: { v: 2, diff: 'ceiling 320 → 340' } },
    { id: 'S-2', v: 1, kind: 'shop', status: 'active', text: 'per-SKU floors · quoting agent may not go below floor', signed: 'Sat 17 Oct' },
    { id: 'R-3', v: 1, kind: 'rescue', status: 'active', text: 'levers enabled: DISCOUNT_THIS_CYCLE (max −25%), PAUSE (max 1 cycle), RETRY_AFTER_FIX · DOWNGRADE off', signed: 'Sat 17 Oct' }
  ],

  agents: [
    { id: 'sourcing', name: 'Sourcing agent', engine: 'claude-code', does: 'haggles for stock' },
    { id: 'supplies', name: 'Supplies agent', engine: 'claude-code', does: 'buys parts & packing' },
    { id: 'infra',    name: 'Infra agent',    engine: 'claude-code', does: 'renders listing photos' },
    { id: 'quoting',  name: 'Quoting agent',  engine: 'claude-code', does: 'answers other agents at the counter' },
    { id: 'rescue',   name: 'Rescue agent',   engine: 'claude-code', does: 'chases failed renewals' },
    { id: 'book',     name: 'Book agent',     engine: 'claude-code', does: 'turns questions into queries' }
  ],

  counterparties: {
    dan:   { id: 'dan', name: 'Dan · north-desk', who: 'resells surplus office monitors', key: '47be…0d', paired: 'words ✓ otter basil quartz meadow', firstSeen: 'Mon 12 Oct', deals: 1, payee: 'north-desk-biz (sandbox)' },
    house: { id: 'house', name: 'HOUSE seller', who: 'scripted sandbox seller, no LLM (for one-install demos)', key: 'pinned in release', paired: 'house key pinned', firstSeen: 'Thu 22 Oct', deals: 1, payee: 'house-seller (sandbox)' },
    lark:  { id: 'lark', name: 'agent of wallet “lark”', who: 'another wallet user’s buying agent', key: 'c201…7a', paired: 'counter guest', firstSeen: 'Tue 27 Oct', deals: 1 },
    fern:  { id: 'fern', name: 'agent of wallet “fern-ops”', who: 'another wallet user’s buying agent', key: 'e9a4…13', paired: 'counter guest', firstSeen: 'Thu 29 Oct', deals: 0 },
    packrite: { id: 'packrite', name: 'packrite-supply', who: 'packing supplier · wallet shop (route ①)', key: '0b77…c4', paired: 'wallet shop', firstSeen: 'Sep', deals: 4 },
    cablehaus:{ id: 'cablehaus', name: 'cablehaus', who: 'cables & adapters · wallet shop (route ①)', key: '5d10…88', paired: 'wallet shop', firstSeen: 'Sep', deals: 3 },
    partsco: { id: 'partsco', name: 'dockparts.example', who: 'parts supplier · payee route · sandbox (route ②)', key: '—', paired: 'cooperating sandbox merchant', firstSeen: 'Thu 29 Oct', deals: 0 },
    gpu:   { id: 'gpu', name: 'gpu-cloud.example', who: 'GPU reseller (unknown)', key: '—', paired: 'not paired', firstSeen: 'Tue 27 Oct', deals: 0 },
    hub:   { id: 'hub', name: 'deal-hub-22', who: 'stranger, unpaired', key: '—', paired: 'not paired', firstSeen: 'Wed 28 Oct', deals: 0 },
    pixel: { id: 'pixel', name: 'pixel-bay', who: 'new seller, paired today', key: 'aa31…f0', paired: 'words ✓ today', firstSeen: 'Thu 29 Oct (today)', deals: 0 },
    ridge: { id: 'ridge', name: 'ridge-lane', who: 'reseller, paired', key: '3c9e…51', paired: 'words ✓', firstSeen: 'Fri 23 Oct', deals: 0 }
  },

  market: {
    'monitor-27-4k': { p25: 301, median: 318, p75: 336, src: 'Channel3 /similar-products', retrieved: '14:02', tracking: 'tracking since Oct 14' },
    'monitor-24-ips': { p25: 196, median: 207, p75: 224, src: 'Channel3 /similar-products', retrieved: '13:40' },
    'usb-c-dock': { p25: 58, median: 66, p75: 74, src: 'Channel3 /lookup-product', retrieved: '09:01' },
    'stand': { p25: 38, median: 44, p75: 49, src: 'Channel3 /similar-products', retrieved: '13:10' },
    'monitor-arm': { p25: 55, median: 63, p75: 71, src: 'Channel3 /similar-products', retrieved: '14:00' }
  },

  /* Haggle D-0193: signed envelopes so far (seq, by, price). Bids rise 290 → 327, asks fall 389 → 329. */
  haggle: {
    list: 389, ceiling: 340, rounds: 6, deadline: '18:00',
    envelopes: [
      { seq: 1, by: 'them', typ: 'LISTING', price: 389, t: '13:21' },
      { seq: 2, by: 'you', typ: 'OFFER', price: 290, t: '13:23' },
      { seq: 3, by: 'them', typ: 'COUNTER', price: 372, t: '13:26' },
      { seq: 4, by: 'you', typ: 'COUNTER', price: 305, t: '13:30' },
      { seq: 5, by: 'them', typ: 'COUNTER', price: 355, t: '13:34' },
      { seq: 6, by: 'you', typ: 'COUNTER', price: 314, t: '13:39' },
      { seq: 7, by: 'them', typ: 'COUNTER', price: 344, t: '13:44' },
      { seq: 8, by: 'you', typ: 'COUNTER', price: 321, t: '13:49' },
      { seq: 9, by: 'them', typ: 'COUNTER', price: 333, t: '13:53' },
      { seq: 10, by: 'you', typ: 'COUNTER', price: 327, t: '13:57' },
      { seq: 11, by: 'them', typ: 'COUNTER', price: 329, t: '14:00' }
    ]
  },

  /* module: tables | spend | counter | book | shield | rescue
     state vocabulary is the report's; `money` says what PayPal holds right now. */
  deals: [
    { id: 'D-0193', module: 'tables', kind: 'haggle · buy', side: 'buyer', cp: 'dan', agent: 'sourcing', item: 'Refurbished 27-inch 4K monitor', ref: 'monitor-27-4k',
      amount: 329, state: 'NEGOTIATING', sub: 'round 5/6 · agent wants to accept $329', pending: 'countersign',
      money: 'none — nothing has been sent to PayPal', when: 'Thu 14:00', day: 'Thu', delivery: 'ShipThenCapture · 3 days', shield: 'CLEAR', rec: 'n/a',
      silence: 'the offer lapses at 18:00 · no money moves' },
    { id: 'D-0201', module: 'tables', kind: 'haggle · buy', side: 'buyer', cp: 'house', agent: 'sourcing', item: 'Refurbished 24-inch IPS monitor', ref: 'monitor-24-ips',
      amount: null, state: 'PAIRING', sub: 'the house seller is waking up (≈ 1 min)', money: 'none', when: 'Thu 13:58', day: 'Thu', rec: 'n/a' },
    { id: 'D-0187', module: 'tables', kind: 'haggle · buy', side: 'buyer', cp: 'dan', agent: 'sourcing', item: 'Refurbished 24-inch monitor', ref: 'monitor-24-ips',
      amount: 212, state: 'RECEIPTED', sub: 'p41 vs market · transcript 2b8e…41', money: 'captured by Dan · receipt verified', when: 'Mon 11:20', day: 'Mon', pct: 41, rec: 'matched',
      pp: { order: '5UV28…K1', intent: 'AUTHORIZE', auth: '3HF1…', capture: '8TA0…' } },
    { id: 'D-0176', module: 'tables', kind: 'haggle · buy', side: 'buyer', cp: 'ridge', agent: 'sourcing', item: 'Refurbished 32-inch 4K monitor', ref: 'monitor-32-4k',
      amount: null, state: 'WITHDRAWN', sub: 'max rounds reached at $455 vs ask $498 · auto-WITHDRAW{ROUNDS}', money: 'none — no order was ever issued', when: 'Mon 16:05', day: 'Mon', rec: 'n/a' },

    { id: 'D-0192', module: 'spend', kind: 'purchase', side: 'buyer', cp: 'gpu', agent: 'infra', item: '40 × GPU (cloud rental, 1 month)', ref: 'gpu',
      amount: null, ask: 'quoted $11,960', state: 'REFUSED', sub: 'clause 3: max_amount $200 per deal; category compute not allowed', money: 'none — 0 PayPal calls', when: 'Tue 10:14', day: 'Tue', rec: 'n/a' },
    { id: 'D-0190', module: 'spend', kind: 'purchase', side: 'buyer', cp: 'partsco', agent: 'supplies', item: 'USB-C dock for the test bench', ref: 'usb-c-dock',
      amount: 64, state: 'AUTHORIZED', sub: 'clause 7: payee not on allowlist → needs your capture', pending: 'capture', pct: 40,
      money: 'held — authorized at PayPal, not captured', when: 'Thu 09:02', day: 'Thu', holdUntilMin: 2*1440 + 19*60, rec: 'n/a',
      silence: 'auto-void at 72 h · the hold is released, nothing is paid', route: 'payee route · sandbox',
      pp: { order: '9LM44…2C', intent: 'AUTHORIZE', auth: '0RW7…', capture: null } },
    { id: 'D-0186', module: 'spend', kind: 'purchase', side: 'buyer', cp: 'packrite', agent: 'supplies', item: 'Packing foam + boxes (20)', ref: 'packing',
      amount: 45, state: 'CAPTURED', sub: 'captured by policy · clause 6 (under $250, allowlisted)', money: 'captured', when: 'Wed 15:31', day: 'Wed', pct: null, rec: 'pending', decided: 'policy:clause6',
      pp: { order: '1QE09…7D', intent: 'AUTHORIZE', auth: '4YB2…', capture: '6CC1…' } },
    { id: 'D-0183', module: 'spend', kind: 'purchase', side: 'buyer', cp: 'cablehaus', agent: 'supplies', item: 'DP + HDMI cable set (10)', ref: 'cables',
      amount: 38, state: 'CAPTURED', sub: 'captured by policy · clause 6', money: 'captured', when: 'Tue 12:02', day: 'Tue', rec: 'matched', decided: 'policy:clause6',
      pp: { order: '7JR51…0P', intent: 'AUTHORIZE', auth: '2KD8…', capture: '9PL3…' } },
    { id: 'D-0181', module: 'spend', kind: 'purchase', side: 'buyer', cp: 'packrite', agent: 'supplies', item: 'Panel cleaning kit (6)', ref: 'cleaning',
      amount: 52, state: 'CAPTURED', sub: 'captured by policy · clause 6', money: 'captured', when: 'Mon 09:47', day: 'Mon', rec: 'matched', decided: 'policy:clause6',
      pp: { order: '2WS77…4A', intent: 'AUTHORIZE', auth: '8MN1…', capture: '1HX5…' } },
    { id: 'D-0180', module: 'spend', kind: 'purchase', side: 'buyer', cp: 'cablehaus', agent: 'supplies', item: 'Thermal pads (duplicate order)', ref: 'pads',
      amount: 42, state: 'VOIDED', sub: 'you voided a duplicate · hold released', money: 'voided — nothing paid', when: 'Tue 08:30', day: 'Tue', rec: 'n/a',
      pp: { order: '4ZT10…9Q', intent: 'AUTHORIZE', auth: '5GV6…', capture: null } },

    { id: 'Q-0207', module: 'counter', kind: 'shop quote · sell', side: 'seller', cp: 'lark', agent: 'quoting', item: 'Single monitor arm', ref: 'monitor-arm',
      amount: 61, state: 'QUOTED', sub: 'list $64 · floor $58 · quote expires 14:12', money: 'none — a quote is not an order', when: 'Thu 14:02', day: 'Thu', expiresMin: 10, rec: 'n/a' },
    { id: 'D-0189', module: 'counter', kind: 'shop order · sell', side: 'seller', cp: 'fern', agent: 'quoting', item: 'Dual monitor arm', ref: 'monitor-arm-dual',
      amount: 90, state: 'AWAITING BUYER APPROVAL', sub: 'list $96 · floor $86 · buyer approves on PayPal', money: 'none yet — the buyer has not approved', when: 'Thu 13:31', day: 'Thu', rec: 'n/a',
      silence: 'if the buyer does nothing, the order expires · no money moves', pp: { order: '6GH30…8W', intent: 'CAPTURE', auth: null, capture: null } },
    { id: 'D-0185', module: 'counter', kind: 'shop order · sell', side: 'seller', cp: 'lark', agent: 'quoting', item: 'Screen-wipe kit', ref: 'wipe-kit',
      amount: 18.5, state: 'CAPTURED', sub: 'p55 vs market · matched in Transaction Search', money: 'captured — paid to you', when: 'Tue 17:12', day: 'Tue', pct: 55, rec: 'matched',
      pp: { order: '3MK82…5R', intent: 'CAPTURE', auth: null, capture: '7BN4…' } },

    { id: 'D-0196', module: 'shield', kind: 'purchase · offer in', side: 'buyer', cp: 'hub', agent: 'sourcing', item: '27-inch 4K monitor (unsolicited offer)', ref: 'monitor-27-4k',
      amount: 460, state: 'BLOCK', sub: '45% over market median · asks for “friends & family”', money: 'none — no PayPal link ever opened', when: 'Wed 19:40', day: 'Wed', rec: 'n/a',
      shield: 'BLOCK', note: 'please send as friends & family to save fees, i ship same day promise', typology: 'Buyer Scam', rules: ['“Pay as friends & family” (deterministic)', '40% over market: $460 vs median $318 (Channel3)'] },
    { id: 'D-0198', module: 'shield', kind: 'purchase', side: 'buyer', cp: 'pixel', agent: 'sourcing', item: 'Monitor stand, walnut (2)', ref: 'stand',
      amount: 140, state: 'HOLD', sub: '59% over market median · new counterparty, first seen today', pending: 'release', money: 'none — held before any PayPal call', when: 'Thu 13:12', day: 'Thu', rec: 'n/a',
      shield: 'HOLD', note: 'Two walnut stands, ships Monday. Thanks!', rules: ['Over 1.4 × market median: $70 vs $44 (Channel3) → HOLD', 'New counterparty: first_seen today and amount > $100 (alone this would ASK)'], silence: 'the request lapses at 20:00 · nothing is paid' },

    { id: 'D-0188', module: 'rescue', kind: 'rescue', side: 'seller', cp: 'S-14', agent: 'rescue', item: 'Care plan · subscriber S-14', ref: 'care-plan',
      amount: 9.6, state: 'FAILED', sub: 'renewal failed ×1 · PayPal retries in 4 d · suggested −20% this cycle', pending: 'lever', money: 'none — no invoice exists yet', when: 'Thu 06:00', day: 'Thu', rec: 'n/a', replay: true,
      silence: 'nothing is sent · PayPal’s own retry runs in 4 d' }
  ],

  shop: [
    { sku: 'monitor-27-4k', title: 'Refurbished 27" 4K IPS monitor', price: 399, floor: 359, avail: 'in_stock', kind: 'PHYSICAL', mkt: 318 },
    { sku: 'monitor-24-ips', title: 'Refurbished 24" IPS monitor', price: 229, floor: 199, avail: 'in_stock', kind: 'PHYSICAL', mkt: 207 },
    { sku: 'monitor-27-qhd', title: 'Refurbished 27" QHD monitor', price: 299, floor: 269, avail: 'in_stock', kind: 'PHYSICAL', mkt: 284 },
    { sku: 'monitor-32-4k', title: 'Refurbished 32" 4K monitor', price: 489, floor: 449, avail: 'out_of_stock', kind: 'PHYSICAL', mkt: 466 },
    { sku: 'monitor-arm', title: 'Single monitor arm, gas spring', price: 64, floor: 58, avail: 'in_stock', kind: 'PHYSICAL', mkt: 63 },
    { sku: 'monitor-arm-dual', title: 'Dual monitor arm, gas spring', price: 96, floor: 86, avail: 'in_stock', kind: 'PHYSICAL', mkt: 92 },
    { sku: 'usb-c-dock', title: 'USB-C dock, 96 W, 2 × DP', price: 64, floor: 60, avail: 'in_stock', kind: 'PHYSICAL', mkt: 66 },
    { sku: 'dp-cable-2m', title: 'DisplayPort 1.4 cable, 2 m', price: 14, floor: 12, avail: 'in_stock', kind: 'PHYSICAL', mkt: null },
    { sku: 'hdmi-21', title: 'HDMI 2.1 cable, 2 m', price: 16, floor: 13, avail: 'in_stock', kind: 'PHYSICAL', mkt: null },
    { sku: 'wipe-kit', title: 'Screen-wipe kit', price: 18.5, floor: 16, avail: 'in_stock', kind: 'PHYSICAL', mkt: 19 },
    { sku: 'calibration', title: 'Panel calibration', price: 35, floor: 30, avail: 'in_stock', kind: 'SERVICE', mkt: null, feedIssue: 'description under 25 characters' },
    { sku: 'care-plan', title: 'Care plan (monthly)', price: 12, floor: null, avail: 'in_stock', kind: 'SERVICE', mkt: null, sub: true }
  ],

  subscribers: [
    { id: 'S-14', plan: 'Care plan $12/mo', state: 'FAILED', fails: 1, retry: 'PayPal retries in 4 d', lever: 'DISCOUNT_THIS_CYCLE', leverText: '−20% this cycle → $9.60 invoice', replay: true, deal: 'D-0188', since: 'Mar 2026' },
    { id: 'S-22', plan: 'Care plan $12/mo', state: 'FAILED', fails: 2, retry: 'PayPal retries in 18 h', lever: 'PAUSE', leverText: 'none yet · waits for PayPal’s retry', retryBlocked: true, since: 'Jun 2026' },
    { id: 'S-09', plan: 'Care plan $12/mo', state: 'RETRY SUCCEEDED', fails: 1, retry: 'PayPal’s own retry paid $12 on Tue', since: 'Jan 2026' },
    { id: 'S-05', plan: 'Care plan $12/mo', state: 'LOST', fails: 2, retry: 'cancelled by subscriber on Mon', since: 'Nov 2025' }
  ],
  activeSubscribers: 6,

  audit: [
    { seq: 4418, t: '14:00:41', actor: 'peer:47be…0d', action: 'envelope.in COUNTER $329.00 · verified', deal: 'D-0193' },
    { seq: 4417, t: '13:58:12', actor: 'agent:sourcing', action: 'table.open HOUSE · monitor-24-ips', deal: 'D-0201' },
    { seq: 4416, t: '13:57:30', actor: 'agent:sourcing', action: 'envelope.out COUNTER $327.00 · signed (clause 4 ✓)', deal: 'D-0193' },
    { seq: 4411, t: '13:31:05', actor: 'agent:quoting', action: 'shop.checkout order 6GH30…8W $90.00', deal: 'D-0189' },
    { seq: 4409, t: '13:12:44', actor: 'shield', action: 'HOLD pixel-bay $140.00 · 59% over median (new counterparty)', deal: 'D-0198' },
    { seq: 4402, t: '09:02:18', actor: 'paypal', action: 'authorize 0RW7… $64.00 (hold)', deal: 'D-0190' },
    { seq: 4371, t: 'Wed 19:40', actor: 'shield', action: 'BLOCK deal-hub-22 $460.00 · F&F + 45% over median', deal: 'D-0196' },
    { seq: 4302, t: 'Tue 10:14', actor: 'policy', action: 'REFUSED 40 × GPU · clause 3 · 0 PayPal calls', deal: 'D-0192' }
  ],

  engineWeekUSD: 2.14,
  transcriptHead: '7c1e…94'
};
