/* The Table · reads one of the product's two scale worlds (../data/scale/small.js or large.js,
   chosen by ?scale=small|large) and puts it in the owner's words for the page. Nothing here is
   paid: every row is invented sample data in PayPal sandbox or replay mode.
   Time: the worlds were built at 2026-10-14 14:30 UTC; that instant is "now" for every deadline
   and "ago", and countdowns keep running from page load. */
(function () {
  'use strict';
  var T = window.TABLE, money = T.money, count = T.count;
  var q = ''; try { q = new URLSearchParams(location.search).get('scale') || ''; } catch (e) { q = ''; }
  var SCALE = q === 'large' ? 'large' : 'small';
  var W = SCALE === 'large' ? window.TABLE_SCALE_LARGE : window.TABLE_SCALE_SMALL;
  T.SCALE = SCALE;
  T.SCALES = { small: { label: 'Small shop', line: 'one person, a handful of deals' }, large: { label: 'Busy merchant', line: 'hundreds of deals, dozens of agents and people' } };
  if (!W) { T.MISSING = true; W = { deals: [], counterparties: [], mandates: [], mandateSlots: {}, revokedMandates: [], pendingPairings: [], notes: {}, audit: [], history: [], rescue: {}, rescueWatches: [], groups: [], envelope: null, settings: {}, engines: [] }; }

  var NOW = 1791988200, D = 86400, H = 3600;
  function rel(t) { return t == null ? null : t - NOW; }
  function short(s, n) {
    s = String(s || ''); if (s.length <= n) return s;
    var cut = s.lastIndexOf(' ', n - 1); if (cut < n * .55) cut = n - 1;
    return s.slice(0, cut).replace(/[\s,·:;(–-]+$/, '') + '…';
  }
  T.short = short;

  /* ---- people ------------------------------------------------------------------------------ */
  var PEOPLE = {}, PAYEE_NAME = {};
  W.counterparties.forEach(function (c) {
    var sub = c.key_id.indexOf('sub_') === 0;
    PEOPLE[c.key_id] = {
      key: c.key_id, name: c.display_name, payee: c.declared_payee || c.display_name, since: rel(c.first_seen), closed: c.deals_closed || 0,
      house: !!c.house, sub: sub,
      verified: c.house ? 'Built into the app · always open' : sub ? 'Your own subscriber' : c.pairing === 'words_confirmed' ? 'Four words matched' : c.pairing === 'house_pinned' ? 'Built into the app' : 'Not connected'
    };
    if (c.declared_payee) PAYEE_NAME[c.declared_payee] = c.display_name;
  });
  function payeeName(p) { return PAYEE_NAME[p] || String(p).replace(/^payee-\d+-/, ''); }

  /* ---- signed rules (mandates) -------------------------------------------------------------- */
  var SLOT_WORD = { negotiator: 'negotiator', shopper: 'shopper', assistant: 'shop assistant' };
  var KIND_WORD = { purchase: 'purchase', haggle: 'haggle', shop_order: 'shop order', rescue: 'rescue' };
  var latest = {}, byIdVer = {};
  W.mandates.forEach(function (m) {
    var p = m.payload; byIdVer[p.id + ':' + p.version] = p;
    if (!latest[p.id] || latest[p.id].version < p.version) latest[p.id] = p;
  });
  var revoked = {}; (W.revokedMandates || []).forEach(function (r) { revoked[r] = true; });
  var AGENT_OF_SUFFIX = {}; Object.keys(W.mandateSlots || {}).forEach(function (id) { AGENT_OF_SUFFIX[id.slice(-4)] = W.mandateSlots[id]; });
  function clauseOf(p, type) { if (!p) return null; for (var i = 0; i < p.clauses.length; i++) if (p.clauses[i].type === type) return p.clauses[i]; return null; }
  function clauseWords(c) {
    switch (c.type) {
      case 'roles': return ['What agents may do', c.roles.map(function (r) { return { buy: 'may buy', shop: 'may run your shop', rescue: 'may rescue renewals', haggle: 'may haggle' }[r] || 'may ' + r; }).join(', ')];
      case 'counterparties': return ['Who they deal with', c.rule.type === 'paired' ? 'only wallets you connected' : c.rule.type === 'subscribers' ? 'only your own subscribers' : c.rule.type === 'pinned' ? 'only ' + count(c.rule.keys.length, 'named wallet') + ' you chose' : 'only wallets you connected'];
      case 'per_deal': return ['Limit per deal', 'up to ' + money(c.max_amount.minor) + ' per ' + (KIND_WORD[c.kind] || 'deal')];
      case 'band': return ['Price range', (c.ceiling ? 'most you’ll pay ' + money(c.ceiling.minor) : 'least you’ll accept ' + money(c.floor ? c.floor.minor : 0)) + ' · ' + c.max_rounds + ' offers'];
      case 'velocity': return ['Daily limit', 'up to ' + c.max_deals_day + ' deals and ' + money(c.max_total_day.minor) + ' a day'];
      case 'human_present_over': return ['Ask me above', 'asks you above ' + money(c.amount.minor)];
      case 'payees': return ['Approved payees', c.payees.length + ' payees', c.payees.map(payeeName)];
      case 'market_watch': return ['Keep prices fresh', count(c.items.length, 'item') + ' · up to ' + c.max_refreshes_day + ' checks a day'];
      case 'lever': return ['Fixes for failed renewals', 'a discount on one missed cycle: up to ' + (c.max_discount_bp / 100) + '% and ' + money(c.max_discount.minor) + ' per subscriber'];
    }
    return null;
  }
  var RULES = [], slotSeen = {};
  Object.keys(latest).forEach(function (id) {
    var p = latest[id], slot = (W.mandateSlots || {})[id] || 'assistant', pd = clauseOf(p, 'per_deal'), roles = clauseOf(p, 'roles');
    var role = roles && roles.roles[0];
    var title = role === 'rescue' ? 'Rescue rules' : slot === 'negotiator' ? 'Negotiator rules' : slot === 'shopper' ? 'Shopper rules' : 'Shop assistant rules';
    slotSeen[title] = (slotSeen[title] || 0) + 1;
    var lines = p.clauses.map(clauseWords).filter(Boolean);
    var hpo = clauseOf(p, 'human_present_over');
    RULES.push({
      key: id, title: title, n: slotSeen[title], version: p.version, agent: 'Your ' + (role === 'rescue' ? 'rescue assistant' : SLOT_WORD[slot] || 'agent'),
      color: role === 'rescue' ? 'rescue' : slot === 'negotiator' ? 'tables' : slot === 'shopper' ? 'spend' : 'counter',
      summary: (pd ? 'up to ' + money(pd.max_amount.minor) + ' per ' + (KIND_WORD[pd.kind] || 'deal') : '') + (hpo ? ' · asks you above ' + money(hpo.amount.minor) : ''),
      signed: rel(p.not_before), left: rel(p.expires), retired: !!revoked[id + ':' + p.version], lines: lines, clauses: p.clauses.length
    });
  });
  RULES.sort(function (a, b) { return (a.retired - b.retired) || a.color.localeCompare(b.color) || a.n - b.n; });
  var groupsN = {}; RULES.forEach(function (r) { groupsN[r.title] = (groupsN[r.title] || 0) + 1; });
  RULES.forEach(function (r) { r.name = groupsN[r.title] > 1 ? r.title + ' · set ' + r.n : r.title; });

  /* ---- deals ------------------------------------------------------------------------------- */
  var HIST = {}; W.history.forEach(function (h) { (HIST[h.deal_id] || (HIST[h.deal_id] = [])).push(h); });
  var GROUP = {}; (W.groups || []).forEach(function (g) { g.deal_ids.forEach(function (id) { GROUP[id] = g.deal_ids; }); });
  var MODULE_OF_KIND = { haggle: 'tables', purchase: 'spend', shop_order: 'counter', rescue: 'rescue' };
  var PAID = { CAPTURED: 1, RECEIPTED: 1, RECONCILED: 1 };
  var STOPPED = { REFUSED: 1, MISMATCH: 1, FAILED: 1, UNCONFIRMED: 1 };
  var CLOSED = { WITHDRAWN: 1, EXPIRED: 1, VOIDED: 1, AUTO_VOIDED: 1 };
  var DEALS = [], BYKEY = {}, BYID = {};

  W.deals.forEach(function (x) {
    var dl = x.deal, dp = x.display, ev = x.evidence, at = x.attention;
    var shieldMod = dl.shield === 'HOLD' || dl.shield === 'BLOCK';
    var d = {
      key: dp.label.replace(/^D-/, ''), id: dl.id, kind: dl.kind, side: dl.side === 'seller' ? 'selling' : 'buying',
      module: at ? at.module : shieldMod ? 'shield' : MODULE_OF_KIND[dl.kind],
      title: dp.title, who: dl.counterparty, qty: dl.terms.qty || 1, unit: dl.terms.unit_price.minor,
      amount: dl.terms.unit_price.minor * (dl.terms.qty || 1), state: dl.state, shield: dl.shield,
      deadline: rel(dp.deadline), silence: dp.on_silence, created: rel(dl.created_at), updated: rel(dl.updated_at),
      checking: !!(ev.money_check && ev.money_check.state === 'parked'), receipt: ev.receipt, recon: ev.reconciliation,
      decidedBy: dl.decided_by ? dl.decided_by.type : null, mandate: dl.mandate_id, mver: dl.mandate_version, _x: x
    };
    if (dl.shield_rule) d.shieldRule = T.SHIELD_RULE[dl.shield_rule] || { text: 'Paused', means: '' };
    if (at && at.shield_rule && !d.shieldRule) d.shieldRule = T.SHIELD_RULE[at.shield_rule];
    if (W.rescue[dl.id]) { var r = W.rescue[dl.id]; d.fix = { was: r.offer.cycle.minor, now: r.offer.invoice.minor, lever: Math.round(r.offer.discount_bp / 100) + '% off this cycle', recipient: r.recipient, failures: r.failed_payments }; d.replay = r.source === 'replay'; d.counted = !!r.counted; }
    if (d.kind === 'rescue') d.amount = d.fix ? d.fix.now : d.amount;
    d.sellerSays = d.state === 'RECEIPTED' && d.side === 'buying' && d.receipt === 'SELLER_ATTESTED';
    if (at) d.need = needOf(d, at);
    if (!at && ENDED(d)) d.closedAgo = d.updated;
    if (W.notes && W.notes[dl.id]) d.note = String(W.notes[dl.id].text).slice(0, 280);
    if (dl.market) {
      var mk = dl.market, u = d.unit, md = mk.median.minor;
      d.market = { low: mk.p25.minor, typical: md, high: mk.p75.minor,
        words: u < mk.p25.minor ? 'below typical' : u <= md * 1.03 ? 'typical' : u <= mk.p75.minor ? 'a bit above typical' : u <= md * 1.4 ? 'above typical' : 'well above typical' };
    }
    if (dp.band) d.range = { most: dp.band.ceiling ? dp.band.ceiling.minor : null, least: dp.band.floor ? dp.band.floor.minor : null, rounds: dp.band.max_rounds, used: dp.band.rounds_used };
    if (x.transcript && x.transcript.length) d.ladder = x.transcript.filter(function (s) { return s.price; }).map(function (s) { return [rel(s.at), s.by, s.price.minor, s.typ]; });
    DEALS.push(d); BYKEY[d.key] = d; BYID[dl.id] = d;
  });
  function ENDED(d) { return !!(STOPPED[d.state] || CLOSED[d.state] || PAID[d.state] || d.shield === 'BLOCK'); }

  function person(d) { return PEOPLE[d.who] || { name: 'Someone', payee: '', since: 0, closed: 0, verified: '' }; }
  function subName(d) { var m = /subscriber (\S+)/i.exec(d.title + ' ' + person(d).name); return m ? 'Subscriber ' + m[1] : short(person(d).name, 28); }

  function needOf(d, at) {
    var p = person(d), nm = short(p.name, 34), amt = money(at.amount_minor), mand = byIdVer[d.mandate + ':' + d.mver] || latest[d.mandate];
    var hpo = clauseOf(mand, 'human_present_over');
    var h = at.headline;
    if (at.module === 'tables' && at.kind === 'gate') return { kind: 'approve', headline: 'Approve ' + amt, ask: nm + ' agreed to ' + amt + '.',
      does: 'Approving signs ' + amt + ' with ' + nm + '. Their shop then makes the PayPal payment request; you approve it on PayPal, and only then is it paid.',
      why: hpo ? 'It is above ' + money(hpo.amount.minor) + ', where your rules ask you first.' : 'Your rules ask you first.' };
    if (at.module === 'spend' && at.kind === 'gate') return { kind: 'payhold', headline: 'Pay or release ' + amt, ask: amt + ' is on hold at PayPal for ' + nm + '.',
      does: 'Pay takes the ' + amt + ' that PayPal is holding. Release cancels the hold and nothing is paid.', why: 'Holds wait for you before they are paid.' };
    if (at.module === 'rescue') return { kind: 'fix', headline: 'Approve a fix ' + amt, ask: subName(d) + '’s ' + money(d.fix ? d.fix.was : at.amount_minor) + ' renewal failed. One fix fits your rules: ' + amt + ' this cycle.',
      does: 'PayPal makes one invoice for this cycle at the discounted price and emails it to your subscriber. Nothing is charged: they pay it on PayPal’s page, or it expires.',
      why: d.replay ? 'This renewal failure was replayed, not reported by PayPal, so what it brings in is never counted as money you got back.' : 'PayPal reported the failed renewal' + (d.fix && d.fix.failures > 1 ? ' (' + d.fix.failures + ' failed payments)' : '') + '. The fix is the one your rescue rules allow.' };
    if (at.module === 'shield') { var sr = d.shieldRule || { text: 'Paused', means: '' };
      return { kind: 'shield', headline: 'Payment paused ' + amt, ask: 'The shield paused ' + amt + ' to ' + nm + ': ' + sr.text.toLowerCase() + '.',
        does: 'Releasing lets it go on inside your rules. Only you can release it, by typing the payee’s name.', why: sr.means }; }
    var mm = /^Mismatch · SETTLE (\S+) ≠ deal (\S+)/.exec(h);
    if (mm) return { kind: 'watch', headline: 'Asked ' + mm[1] + ', not ' + mm[2], ask: nm + '’s payment request asked ' + mm[1] + '. The signed deal says ' + mm[2] + '.',
      does: 'The wallet stopped it. It will not be paid. There is nothing you need to do.', why: 'The payment request did not match the signed deal.' };
    if (d.checking || /^Checking/.test(h)) return { kind: 'watch', headline: 'Checking with PayPal ' + amt, ask: 'A ' + amt + ' sale to ' + nm + ' is being checked with PayPal.',
      does: T.MONEY_CHECK_PARKED, why: 'PayPal’s answer to the collection was lost. Nothing more is sent.' };
    return { kind: 'watch', headline: h, ask: h + '.', does: 'Nothing moves until you decide.', why: '' };
  }

  /* ---- what a deal is called now ------------------------------------------------------------ */
  function word(d) {
    if (d.checking) return { text: 'Checking with PayPal', tone: 'dashed', cls: 'dashed', means: 'PayPal’s answer was lost; the wallet is asking PayPal. Not paid and not failed until PayPal shows which.' };
    if (d.shield === 'HOLD' && !ENDED(d)) return { text: T.SHIELD.HOLD.text, tone: 'gold', means: T.SHIELD.HOLD.means };
    if (d.shield === 'BLOCK') return { text: T.SHIELD.BLOCK.text, tone: 'red', means: T.SHIELD.BLOCK.means };
    if (d.sellerSays) return { text: 'Seller says paid', tone: 'gold', means: T.SELLER_SAYS_PAID };
    if (d.kind === 'rescue' && d.state === 'AGREED') return { text: 'Renewal failed', tone: 'coral', means: 'The subscription renewal did not go through. A fix waits for you; nothing is sent until you approve it.' };
    if (d.kind === 'rescue' && d.state === 'AWAITING_APPROVAL') return { text: 'Invoice sent', tone: 'gold', means: 'PayPal sent one invoice to your subscriber. Nothing is charged unless they pay it.' };
    if (d.state === 'AWAITING_APPROVAL' && d.side === 'selling') return { text: 'Waiting for buyer', tone: 'gold', means: 'The buyer has a PayPal link to approve. No money has moved yet.' };
    var s = T.STATE[d.state] || { text: d.state, tone: 'line', means: '' };
    if (PAID[d.state] && d.side === 'selling') return { text: s.text.replace(/^Paid/, 'Paid to you'), tone: s.tone, means: s.means };
    return { text: s.text, tone: s.tone, cls: s.tone === 'line' ? 'line' : '', means: s.means };
  }
  /* buckets: what the lists filter by */
  function bucket(d) {
    if (d.decided) return d.decidedBucket || 'progress';
    if (d.need) return 'needs';
    if (d.checking || d.sellerSays) return 'progress';
    if (d.shield === 'BLOCK' || STOPPED[d.state]) return 'stopped';
    if (PAID[d.state]) return 'paid';
    if (d.state === 'AUTHORIZED' || d.shield === 'HOLD') return 'hold';
    if (CLOSED[d.state]) return 'closed';
    return 'progress';
  }
  T.BUCKETS = [['needs', 'Needs you'], ['progress', 'In progress'], ['hold', 'On hold'], ['paid', 'Paid'], ['stopped', 'Stopped'], ['closed', 'No money moved']];

  /* ---- a deal's story, rules and proof (made when the deal is opened) ------------------------ */
  function slotOf(d) { return SLOT_WORD[(W.mandateSlots || {})[d.mandate]] || 'agent'; }
  function stepWords(h, d) {
    var a = h.authority.type, nm = short(person(d).name, 40), amt = money(d.amount);
    var byA = { owner: 'you', signed_rule: 'rule', seller_mandate: 'rule', safe_default: 'safe', agent_intent: 'agent' }[a];
    switch (h.kind) {
      case 'created': return d.side === 'buying' ? ['agent', 'Your ' + slotOf(d) + ' opened it'] : ['them', nm + ' asked at your counter'];
      case 'proposed': return ['agent', 'Your shopper proposed it at ' + amt];
      case 'agreed': return [byA || 'rule', 'Both sides signed ' + amt];
      case 'countersigned': return a === 'owner' ? ['you', 'You approved ' + (d.kind === 'rescue' ? 'one fix: ' : '') + amt] : a === 'seller_mandate' ? ['rule', 'Your shop rules agreed ' + amt] : ['rule', 'A rule you signed approved ' + amt];
      case 'owner_accepted': return ['you', 'You accepted ' + amt];
      case 'pay_link_sent': return ['agent', 'Your shop assistant sent the PayPal payment link'];
      case 'pay_link_received': return ['them', nm + ' sent a PayPal payment request'];
      case 'order_created': return [byA || 'rule', 'A PayPal order was created'];
      case 'approved_by_buyer': return ['them', 'The buyer approved on PayPal'];
      case 'authorized': return [byA || 'rule', 'PayPal put ' + amt + ' on hold'];
      case 'captured': return a === 'owner' ? ['you', 'You paid the hold, ' + amt] : a === 'seller_mandate' ? ['rule', 'Collected ' + amt + ' under your shop rules, as the buyer approved'] : ['rule', 'Paid ' + amt + ' under your rules'];
      case 'receipted': return d.side === 'buying' && d.receipt === 'SELLER_ATTESTED' ? ['them', nm + ' says it is paid; receipt saved'] : ['paypal', 'Receipt saved'];
      case 'reconciled': return ['paypal', 'PayPal’s statement shows the same payment'];
      case 'renewal_failed': return ['paypal', d.replay ? 'A ' + money(d.fix ? d.fix.was : d.amount) + ' renewal failed (replayed)' : 'PayPal reported a ' + money(d.fix ? d.fix.was : d.amount) + ' renewal failed'];
      case 'invoice_created': return [byA || 'you', 'PayPal made one invoice for ' + amt];
      case 'invoice_sent': return ['paypal', 'PayPal sent the invoice to ' + (d.fix ? d.fix.recipient : 'your subscriber')];
      case 'invoice_paid': return ['paypal', subName(d) + ' paid the invoice'];
      case 'lapsed': return ['safe', 'Left alone, it lapsed. Nothing was sent.'];
      case 'expired': return ['safe', 'It expired at its deadline. No money moved.'];
      case 'withdraw_sent': return ['agent', 'Your ' + slotOf(d) + ' walked away. No money moved.'];
      case 'withdraw_received': return ['them', nm + ' walked away. No money moved.'];
      case 'auto_voided': return ['safe', 'The hold ran out and released itself. Nothing was paid.'];
      case 'voided': return a === 'owner' ? ['you', 'You released the hold. Nothing was paid.'] : ['rule', 'The hold was released. Nothing was paid.'];
      case 'shield_held': return ['shield', 'The shield paused it before any PayPal call' + (d.shieldRule ? ': ' + d.shieldRule.text.toLowerCase() : '')];
      case 'refused': return ['rule', d.shield === 'BLOCK' ? 'Blocked for good. PayPal was never asked.' : 'Refused by your rules. PayPal was never asked.'];
      case 'mismatch': return ['shield', 'The payment request did not match the signed deal. Stopped; nothing is paid.'];
      case 'failed': return ['paypal', 'The payment failed at PayPal. Nothing was paid.'];
      case 'unconfirmed': return ['paypal', 'PayPal’s statement did not confirm the seller’s word. Your wallet moved nothing.'];
      case 'checking_with_paypal': return ['paypal', 'PayPal’s answer was lost. The wallet is checking with PayPal.'];
    }
    return null;
  }
  function story(d) {
    var hs = HIST[d.id] || [], out = [], run = null, L = d.ladder || [];
    hs.forEach(function (h) {
      if (h.kind === 'offer_sent' || h.kind === 'offer_received') {
        if (!run) { run = { at: h.at, n: 0, you: 0, them: 0 }; out.push(run); }
        run.n++; run[h.kind === 'offer_sent' ? 'you' : 'them']++; return;
      }
      run = null; var w = stepWords(h, d); if (w) out.push([rel(h.at), w[0], w[1]]);
    });
    return out.map(function (s) {
      if (!s.n) return s;
      var lastYou = null, lastThem = null; L.forEach(function (x) { if (x[1] === 'you') lastYou = x[2]; else lastThem = x[2]; });
      if (s.n === 1) return [rel(s.at), s.you ? 'agent' : 'them', s.you ? 'Your ' + slotOf(d) + ' made an offer' : short(person(d).name, 40) + ' made an offer'];
      return [rel(s.at), 'agent', s.n + ' offers traded inside your range' + (lastYou && lastThem ? ': theirs ended at ' + money(lastThem) + ', yours at ' + money(lastYou) : '')];
    });
  }
  function rules(d) {
    var m = byIdVer[d.mandate + ':' + d.mver] || latest[d.mandate], out = [];
    if (!m) return out;
    var refusedClause = d._x.deal.decided_by && d._x.deal.decided_by.type === 'policy' && d.state === 'REFUSED' ? d._x.deal.decided_by.clause : null;
    m.clauses.forEach(function (c, i) {
      var w = clauseWords(c); if (!w || c.type === 'roles' || c.type === 'market_watch') return;
      var r = { name: w[0], says: w[1], result: 'pass', why: 'Fits' };
      if (c.type === 'per_deal') r.why = d.amount > c.max_amount.minor ? money(d.amount) + ' is over the limit' : 'Inside the limit';
      if (c.type === 'per_deal' && d.amount > c.max_amount.minor) r.result = 'stop';
      if (c.type === 'band') {
        var lim = c.ceiling ? c.ceiling.minor : c.floor ? c.floor.minor : null, over = c.ceiling ? d.unit > lim : lim != null && d.unit < lim;
        r.result = over ? 'stop' : 'pass'; r.why = over ? money(d.unit) + ' is outside the range' : d.range && d.range.used ? 'Inside · offer ' + d.range.used + ' of ' + d.range.rounds : 'Inside the range';
      }
      if (c.type === 'human_present_over') {
        var above = d.amount > c.amount.minor;
        r.result = above ? 'asks' : 'pass'; r.why = above ? (d.need ? 'This is why it waits for you' : 'You were asked') : 'Under ' + money(c.amount.minor) + ', so your rule could act';
      }
      if (c.type === 'payees') { r.says = c.payees.length <= 3 ? 'only ' + c.payees.map(payeeName).join(', ') : 'only ' + c.payees.slice(0, 2).map(payeeName).join(', ') + ' and ' + (c.payees.length - 2) + ' more'; r.full = c.payees.map(payeeName); r.why = d.shieldRule === T.SHIELD_RULE.payee_mismatch ? 'Not the payee you agreed' : 'Approved'; if (d.shieldRule === T.SHIELD_RULE.payee_mismatch) r.result = 'stop'; }
      if (c.type === 'velocity') r.why = 'Fits that day';
      if (c.type === 'counterparties') r.why = person(d).sub ? 'Your subscriber' : 'Connected';
      if (c.type === 'lever') { r.why = d.fix ? money(d.fix.was - d.fix.now) + ' off this cycle' : 'Fits'; if (d.need && d.need.kind === 'fix') { r.result = 'asks'; r.why = 'Every fix waits for your approval'; } }
      if (refusedClause === i + 1) { r.result = 'stop'; r.why = 'This refused it'; }
      out.push(r);
    });
    if (d.shield === 'HOLD' || d.shield === 'BLOCK') out.unshift({ name: 'Shield', says: d.shieldRule ? d.shieldRule.text : 'scam check', result: d.shield === 'BLOCK' ? 'stop' : 'asks', why: d.shieldRule ? d.shieldRule.means : '' });
    return out;
  }
  function proof(d) {
    var pp = d._x.deal.paypal, out = [];
    if (pp.subscription) out.push(['Subscription', 'at PayPal']);
    if (pp.order) out.push([d.kind === 'rescue' ? 'Invoice' : 'PayPal order', d.kind === 'rescue' ? (PAID[d.state] ? 'paid' : 'sent') : (d.state === 'AWAITING_APPROVAL' ? 'created · waiting for the buyer' : 'created')]);
    if (pp.authorization) out.push(['Hold at PayPal', d.state === 'AUTHORIZED' ? money(d.amount) + ' held' : d.state === 'VOIDED' || d.state === 'AUTO_VOIDED' ? 'released' : 'placed']);
    if (d.checking) out.push(['Payment', 'Checking with PayPal']);
    else if (pp.capture || PAID[d.state]) out.push(['Payment', d.receipt === 'SELLER_ATTESTED' ? 'Seller’s receipt' : 'PayPal receipt']);
    if (d.recon === 'matched') out.push(['Statement', 'On statement']); else if (d.recon === 'pending_reporting') out.push(['Statement', 'Not on statement yet']);
    return out;
  }
  function full(d) {
    if (!d) return d;
    if (!d._full) { d._full = true; d.story = story(d); d.rules = rules(d); d.proof = proof(d); d.group = GROUP[d.id] ? GROUP[d.id].map(function (id) { return BYID[id] && BYID[id].key; }).filter(function (k) { return k && k !== d.key; }) : null; }
    return d;
  }

  /* ---- what needs her, soonest first ------------------------------------------------------- */
  var NEEDS = DEALS.filter(function (d) { return d.need; }).sort(function (a, b) {
    var da = a.deadline == null ? 1e12 : a.deadline, db = b.deadline == null ? 1e12 : b.deadline;
    return da - db || (a.need.kind === 'watch') - (b.need.kind === 'watch');
  }).map(function (d) { return d.key; });

  /* ---- the week in money (Book) ------------------------------------------------------------ */
  var WEEKS = 7 * D, dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var inWeek = function (d) { return d.updated != null && d.updated > -WEEKS; };
  var paidOutL = DEALS.filter(function (d) { return d.side === 'buying' && PAID[d.state] && !d.sellerSays && inWeek(d); });
  var paidInL = DEALS.filter(function (d) { return d.side === 'selling' && PAID[d.state] && inWeek(d) && !(d.kind === 'rescue' && !d.counted); });
  var holdL = DEALS.filter(function (d) { return d.state === 'AUTHORIZED' && !d.checking; });
  var checkL = DEALS.filter(function (d) { return d.checking; });
  var stoppedL = DEALS.filter(function (d) { return bucket(d) === 'stopped' && inWeek(d); });
  var sum = function (l) { return l.reduce(function (a, d) { return a + d.amount; }, 0); };
  var byDay = [0, 0, 0, 0, 0, 0, 0], inByDay = [0, 0, 0, 0, 0, 0, 0], labels = [];
  for (var i = 0; i < 7; i++) labels.push(dayNames[new Date((NOW - (6 - i) * D) * 1000).getUTCDay()]);
  function dayIdx(d) { return 6 - Math.floor(-d.updated / D); }
  paidOutL.forEach(function (d) { var k = dayIdx(d); if (k >= 0 && k < 7) byDay[k] += d.amount; });
  paidInL.forEach(function (d) { var k = dayIdx(d); if (k >= 0 && k < 7) inByDay[k] += d.amount; });
  var WEEK = {
    paidOut: sum(paidOutL), paidIn: sum(paidInL), onHold: sum(holdL), checking: sum(checkL), nOut: paidOutL.length, nIn: paidInL.length, nHold: holdL.length, nCheck: checkL.length,
    inProgress: DEALS.filter(function (d) { return bucket(d) === 'progress'; }).length, stopped: stoppedL.length,
    byDay: byDay, inByDay: inByDay, labels: labels
  };
  WEEK.headline = 'This week: ' + money(WEEK.paidOut) + ' paid out, ' + money(WEEK.paidIn) + ' paid in.';
  WEEK.sub = (WEEK.onHold ? money(WEEK.onHold) + ' is on hold at PayPal, not paid yet. ' : 'Nothing is on hold. ') + (WEEK.nCheck ? count(WEEK.nCheck, 'payment') + ' being checked with PayPal.' : '');

  /* ---- module answers ---------------------------------------------------------------------- */
  function of(k) { return k === 'book' ? DEALS : DEALS.filter(function (d) { return d.module === k; }); }
  function waitingIn(k) { return NEEDS.filter(function (key) { return BYKEY[key].module === k; }).length; }
  T.MODULES.forEach(function (m) {
    var l = of(m.key), w = waitingIn(m.key), n = function (b) { return l.filter(function (d) { return bucket(d) === b; }).length; };
    var waitWord = w ? ' · ' + count(w, 'waits', 'wait') + ' for you' : '';
    m.total = l.length; m.waiting = w;
    if (!l.length) { m.answer = m.empty; m.stats = []; return; }
    if (m.key === 'tables') { var live = l.filter(function (d) { return !ENDED(d); }).length; m.answer = count(live, 'live table') + waitWord; }
    else if (m.key === 'spend') m.answer = money(sum(paidOutL.filter(function (d) { return d.module === 'spend'; }))) + ' paid this week' + (w ? ' · ' + count(w, 'hold') + ' to decide' : '');
    else if (m.key === 'counter') { var col = sum(paidInL.filter(function (d) { return d.module === 'counter'; })); var ck = l.filter(function (d) { return d.checking; }).length; m.answer = money(col) + ' collected this week' + (ck ? ' · ' + count(ck, 'payment') + ' being checked' : ''); }
    else if (m.key === 'book') m.answer = WEEK.headline.replace(/^This week: /, '').replace(/\.$/, '') + ' this week';
    else if (m.key === 'shield') { var ps = l.filter(function (d) { return d.shield === 'HOLD' && !ENDED(d); }).length, bl = l.filter(function (d) { return d.shield === 'BLOCK'; }).length; m.answer = (ps ? count(ps, 'payment') + ' paused' : 'Nothing paused') + ' · ' + bl + ' blocked'; }
    else if (m.key === 'rescue') { var rec = sum(l.filter(function (d) { return PAID[d.state] && d.counted; })); m.answer = money(rec) + ' recovered' + (w ? ' · ' + count(w, 'fix', 'fixes') + ' to approve' : ''); }
    m.stats = [['needs', w], ['progress', n('progress') + n('hold')], ['paid', n('paid')], ['stopped', n('stopped') + n('closed')]];
  });

  /* ---- ask your book ------------------------------------------------------------------------ */
  function names(l, k) { return l.slice().sort(function (a, b) { return b.amount - a.amount; }).slice(0, k).map(function (d) { return short(d.title, 40) + ' (' + money(d.amount) + ')'; }).join(', '); }
  var keys = function (l) { return l.slice().sort(function (a, b) { return b.amount - a.amount; }).map(function (d) { return d.key; }); };
  var underRules = DEALS.filter(function (d) { return PAID[d.state] && inWeek(d) && (d.decidedBy === 'policy' || d.decidedBy === 'seller_mandate'); });
  var safeL = DEALS.filter(function (d) { return d.decidedBy === 'safe_default' && inWeek(d); });
  var refusedRule = stoppedL.filter(function (d) { return d.state === 'REFUSED' && d.shield !== 'BLOCK'; }).length, blocks = stoppedL.filter(function (d) { return d.shield === 'BLOCK'; }).length, mism = stoppedL.filter(function (d) { return d.state === 'MISMATCH'; }).length;
  T.ASK = [
    { q: 'What did my agents pay this week?', a: paidOutL.length ? money(WEEK.paidOut) + ', in ' + count(paidOutL.length, 'payment') + '. The largest: ' + names(paidOutL, 3) + '.' : 'Nothing. Your agents paid nothing this week.', keys: keys(paidOutL) },
    { q: 'What is on hold right now?', a: holdL.length ? money(WEEK.onHold) + ' in ' + count(holdL.length, 'hold') + '. PayPal is holding it. If you do nothing, each hold is released at its deadline and nothing is paid.' : 'Nothing is on hold.', keys: keys(holdL) },
    { q: 'What came in this week?', a: paidInL.length ? money(WEEK.paidIn) + ', in ' + count(paidInL.length, 'payment') + '. The largest: ' + names(paidInL, 3) + '.' + (checkL.length ? ' ' + money(WEEK.checking) + ' is still being checked with PayPal and is not counted.' : '') : 'Nothing came in this week.', keys: keys(paidInL) },
    { q: 'What was stopped this week, and why?', a: stoppedL.length ? count(stoppedL.length, 'payment') + ': ' + [refusedRule ? refusedRule + ' refused by your rules' : '', blocks ? blocks + ' blocked by the shield' : '', mism ? count(mism, 'payment request') + ' that did not match the deal' : ''].filter(Boolean).join(', ') + '. None reached PayPal as a payment.' : 'Nothing was stopped this week.', keys: keys(stoppedL) },
    { q: 'Did anything pay without me?', a: 'Only what your signed rules allow: ' + count(underRules.length, 'payment') + ' this week, each under the amount where your rules ask you. ' + (safeL.length ? count(safeL.length, 'deadline') + ' passed; each released a hold or let an offer lapse. ' : '') + 'Waiting never sent money.', keys: keys(underRules) }
  ];

  /* ---- the rewind (history, in words) ------------------------------------------------------- */
  var BYW = { you: 'you', rule: 'rule', agent: 'agent', them: 'them', safe: 'safe', shield: 'shield', paypal: 'paypal' };
  var TONE = { captured: 'ok', receipted: 'ok', reconciled: 'ok', invoice_paid: 'ok', authorized: 'gold', shield_held: 'gold', refused: 'red', mismatch: 'red', failed: 'red', unconfirmed: 'coral', renewal_failed: 'coral', offer_received: 'coral', checking_with_paypal: 'dashed', auto_voided: 'line', voided: 'line', expired: 'line', lapsed: 'line', withdraw_sent: 'line', withdraw_received: 'line', countersigned: 'teal' };
  var STEPS = null;
  function steps() {
    if (STEPS) return STEPS;
    STEPS = [];
    for (var j = W.history.length - 1; j >= 0; j--) {
      var h = W.history[j], d = BYID[h.deal_id]; if (!d) continue;
      if (h.kind === 'offer_sent' || h.kind === 'created' || h.kind === 'order_created' || h.kind === 'approved_by_buyer' || h.kind === 'pay_link_sent' || h.kind === 'invoice_created') continue;
      var w = h.kind === 'offer_received' ? ['them', short(person(d).name, 34) + ' made an offer'] : stepWords(h, d); if (!w) continue;
      STEPS.push({ at: rel(h.at), key: d.key, by: BYW[w[0]], text: w[1], title: d.title, tone: TONE[h.kind] || 'teal', module: d.module });
    }
    return STEPS;
  }
  var since = 2 * D, recent = W.history.filter(function (h) { return h.at - NOW > -since; });
  function cnt(kinds, auth) { return recent.filter(function (h) { return kinds.indexOf(h.kind) >= 0 && (!auth || auth.indexOf(h.authority.type) >= 0); }); }
  function amtOf(l) { return l.reduce(function (a, h) { var d = BYID[h.deal_id]; return a + (d ? d.amount : 0); }, 0); }
  var aPaid = cnt(['captured'], ['signed_rule', 'seller_mandate']), aSelf = cnt(['auto_voided']), aShield = cnt(['shield_held']), aRef = cnt(['refused']), aLapse = cnt(['expired', 'lapsed']), aYou = recent.filter(function (h) { return h.authority.type === 'owner'; });
  T.AWAY = { since: 'Since you last looked, 2 days ago', lines: [
    aPaid.length ? { tone: 'ok', text: 'Your rules paid or collected ' + money(amtOf(aPaid)) + ' (' + count(aPaid.length, 'payment') + ')' } : null,
    aYou.length ? { tone: 'teal', text: 'You made ' + count(aYou.length, 'decision') } : null,
    aSelf.length ? { tone: 'line', text: count(aSelf.length, 'hold') + ' released ' + (aSelf.length === 1 ? 'itself' : 'themselves') + ' (' + money(amtOf(aSelf)) + '), nothing was paid' } : null,
    aLapse.length ? { tone: 'line', text: count(aLapse.length, 'offer') + ' lapsed at the deadline, no money moved' } : null,
    aShield.length ? { tone: 'gold', text: 'The shield paused ' + count(aShield.length, 'payment') + ' before any PayPal call' } : null,
    aRef.length ? { tone: 'red', text: count(aRef.length, 'payment') + ' refused before PayPal was asked' } : null,
    checkL.length ? { tone: 'dashed', text: 'Checking with PayPal on ' + count(checkL.length, 'payment') + ' (' + money(sum(checkL)) + '): not paid and not failed until PayPal shows which' } : null
  ].filter(Boolean), steps: recent.length };
  if (!T.AWAY.lines.length) T.AWAY.lines.push({ tone: 'line', text: 'Nothing happened. No money moved.' });
  T.AWAY.headline = T.AWAY.lines[0].text;

  /* ---- the record (audit ledger, in words) -------------------------------------------------- */
  var ACTION = {
    'mandate.signed': 'Signed a set of rules', 'pairing.confirmed': 'Confirmed four words with a new wallet', 'deadline.set': 'Set a deadline', 'deal.countersigned': 'Approved a deal',
    'money.create_invoice': 'Asked PayPal to make an invoice', 'money.send_invoice': 'Asked PayPal to send the invoice', 'market.refresh': 'Checked market prices', 'preferences.changed': 'Changed a setting',
    'deadline.swept': 'A deadline passed; its safe default applied', 'reporting.polled': 'Read PayPal’s statement', 'engine.run': 'Ran an agent', 'deal.created': 'Opened a deal',
    'deal.offer_received': 'Received an offer', 'deal.offer_sent': 'Sent an offer', 'money.create_order': 'Asked PayPal for an order', 'money.read_order': 'Read the PayPal order',
    'money.authorize': 'Asked PayPal to hold the money', 'money.capture': 'Asked PayPal to take the held money', 'money.void': 'Asked PayPal to release a hold', 'deal.pay_link_sent': 'Sent a PayPal payment link',
    'deal.shield_held': 'Paused a payment for a scam check', 'deal.checking_with_paypal': 'Started checking with PayPal'
  };
  function actorWord(a) {
    if (a === 'owner') return ['you', 'You'];
    if (a === 'policy') return ['rule', 'Your rules'];
    if (a === 'pipeline') return ['wallet', 'The wallet'];
    if (a === 'agent:engine') return ['agent', 'Agent app'];
    if (a.indexOf('agent:') === 0) { var s = AGENT_OF_SUFFIX[a.slice(6)]; return ['agent', 'Your ' + (SLOT_WORD[s] || 'agent')]; }
    return ['wallet', 'The wallet'];
  }
  function record(r) {
    var a = actorWord(r.actor), d = r.deal_id ? BYID[r.deal_id] : null;
    var what = r.action === 'deal.transition' ? (r.to && T.STATE[r.to] ? 'Moved a deal to “' + T.STATE[r.to].text + '”' : 'Moved a deal on') : (ACTION[r.action] || 'A step');
    var dec = r.decided_by ? { human: 'decided by you', policy: 'under a rule you signed', seller_mandate: 'under your shop rules', safe_default: 'safe default' }[r.decided_by.type] : '';
    return { at: rel(r.at), who: a[0], whoText: a[1], what: what, dec: dec || '', money: r.action.indexOf('money.') === 0, key: d ? d.key : null, title: d ? d.title : '' };
  }
  T.RECORD = { size: W.audit.length, row: function (i) { return record(W.audit[W.audit.length - 1 - i]); }, raw: W.audit };

  /* ---- limits, connections, watches, pairings ---------------------------------------------- */
  var env = W.envelope ? W.envelope.payload : null, todayDeals = DEALS.filter(function (d) { return d.created != null && d.created > -D; }).length;
  T.LIMITS = env ? [
    { name: 'Most your agents can pay out in a day', short: 'Paid out today', used: W.walletSpendTodayMinor || 0, max: env.max_out_day.minor },
    { name: 'Most on hold at once', short: 'On hold now', used: WEEK.onHold, max: env.max_held.minor },
    { name: 'Most deals a day', short: 'Deals today', usedN: todayDeals, maxN: env.max_deals_day }
  ] : [];
  var eng = (W.engines || []), avail = eng.filter(function (e) { return e.available; }).length;
  T.CONNECTIONS = [
    { name: 'PayPal connection', line: W.credentialsStoredAt && W.credentialsStoredAt.paypal_sandbox ? 'sandbox app keys saved ' + T.ago(rel(W.credentialsStoredAt.paypal_sandbox)) + ' · kept securely on this computer' : 'not connected', state: W.credentialsStoredAt && W.credentialsStoredAt.paypal_sandbox ? 'connected' : 'not connected', tone: 'ok' },
    { name: 'PayPal statement', line: W.lastReportingPoll ? 'last read ' + T.ago(rel(W.lastReportingPoll.at)) : 'not read yet', state: W.lastReportingPoll && W.lastReportingPoll.status === 200 ? 'reading' : 'waiting', tone: 'ok' },
    { name: 'Market prices', line: 'the key for comparing prices · kept securely on this computer', state: W.settings && W.settings.channel3_configured ? 'connected' : 'not set', tone: W.settings && W.settings.channel3_configured ? 'ok' : 'line' },
    { name: 'Agent apps', line: eng.length - avail + ' supported agent apps are not ready yet: each waits for a safety check · the practice agent plays your deals', state: avail ? 'practice agent' : 'none ready', tone: 'teal' },
    { name: 'House seller', line: 'a practice shop that is always open · wakes up when you join its table', state: W.settings && W.settings.house_connected ? 'connected' : 'asleep', tone: 'line' }
  ];
  var WATCH_WORD = { waiting: ['waiting for the next check', 'line'], paid: ['renewals paid', 'ok'], fix_opened: ['fix suggested', 'gold'], failed_no_fix: ['failed, no fix fits your rules', 'red'], cant_read: ['can’t read it right now', 'dashed'] };
  T.WATCHES = (W.rescueWatches || []).map(function (w) { var ww = WATCH_WORD[w.state] || [w.state, 'line']; return { who: w.recipient, plan: 'Care plan', state: ww[0], tone: ww[1], next: rel(w.next_read_at) }; });
  T.PENDING = (W.pendingPairings || []).map(function (p, i) { return { i: i, words: p.words, context: p.display_context, expires: rel(p.expires), house: p.house }; });
  T.SETTINGS = W.settings || {};

  /* ---- exports -------------------------------------------------------------------------------- */
  T.PEOPLE = PEOPLE; T.DEALS = DEALS; T.NEEDS = NEEDS; T.RULES = RULES; T.WEEK = WEEK;
  T.deal = function (key) { return full(BYKEY[key]); };
  T.light = function (key) { return BYKEY[key]; };
  T.of = of; T.person = function (k) { return PEOPLE[k]; }; T.word = word; T.bucket = bucket; T.steps = steps;
  T.ended = ENDED; T.personOf = person;
  T.COUNTS = { deals: DEALS.length, people: W.counterparties.filter(function (c) { return c.key_id.indexOf('sub_') !== 0; }).length, subs: W.counterparties.filter(function (c) { return c.key_id.indexOf('sub_') === 0; }).length, rules: RULES.length, agents: Object.keys(AGENT_OF_SUFFIX).length };
})();
