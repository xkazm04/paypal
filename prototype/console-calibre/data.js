/* The Table · the fixed vocabulary of this prototype.
   Words come from the product's own vocabulary (data/current-app/src/lib/words.ts). The rows
   themselves (deals, people, rules, the ledger) are not here: world.js reads them from the
   product's scale fixtures in ../data/scale/ (small or large). Every shop and person there is
   fictional; all money is PayPal sandbox test money. Nothing here is paid. */
(function () {
  'use strict';
  var H = 3600, D = 86400, M = 60;

  /* ---- helpers ----------------------------------------------------------------------------- */
  function money(minor, opts) {
    var neg = minor < 0; var a = Math.abs(Math.round(minor));
    var whole = Math.floor(a / 100), cents = a % 100;
    var s = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '−' : '') + '$' + s + '.' + (cents < 10 ? '0' : '') + cents + (opts && opts.code ? ' USD' : '');
  }
  function timeLeft(seconds) {
    if (seconds <= 0) return 'now';
    var d = Math.floor(seconds / D), h = Math.floor((seconds % D) / H), m = Math.floor((seconds % H) / M);
    if (d) return d + ' ' + (d === 1 ? 'day' : 'days') + (h ? ' ' + h + ' h' : '');
    if (h) return h + ' h' + (m ? ' ' + m + ' min' : '');
    return Math.max(1, m) + ' min';
  }
  function ago(seconds) {
    var s = Math.abs(seconds);
    if (s < 90) return 'just now';
    if (s < H) return Math.round(s / M) + ' min ago';
    if (s < D) return Math.round(s / H) + ' h ago';
    var d = Math.round(s / D); return d === 1 ? 'yesterday' : d + ' days ago';
  }
  function count(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  /* ---- words (from words.ts) --------------------------------------------------------------- */
  var STATE = {
    PAIRING: { text: 'Connecting', tone: 'teal', means: 'The two wallets are confirming each other. Nothing is offered yet.' },
    LISTED: { text: 'Listed', tone: 'teal', means: 'On the table. No offer has been made yet.' },
    NEGOTIATING: { text: 'Negotiating', tone: 'teal', means: 'The agents are trading offers inside your price range. No money has moved.' },
    AGREED: { text: 'Agreed', tone: 'teal', means: 'Both sides signed the same price. No money has moved yet.' },
    SETTLING: { text: 'Preparing payment', tone: 'teal', means: 'The seller is creating the PayPal order. No money has moved yet.' },
    AWAITING_APPROVAL: { text: 'Waiting for approval', tone: 'gold', means: 'Waiting for an approval on PayPal. No money has moved yet.' },
    APPROVED: { text: 'Approved on PayPal', tone: 'gold', means: 'The buyer approved on PayPal. The money is not taken yet.' },
    AUTHORIZED: { text: 'On hold', tone: 'gold', means: 'PayPal is holding the money. It is paid only when collected, and released if not.' },
    CAPTURED: { text: 'Paid', tone: 'ok', means: 'The money moved at PayPal.' },
    RECEIPTED: { text: 'Paid, receipt saved', tone: 'ok', means: 'Paid, and the receipt is stored with the deal.' },
    RECONCILED: { text: 'Paid, on statement', tone: 'ok', means: 'Paid, and PayPal’s own statement shows the same payment.' },
    WITHDRAWN: { text: 'Withdrawn', tone: 'line', means: 'Someone walked away before paying. No money moved.' },
    EXPIRED: { text: 'Expired', tone: 'line', means: 'The deadline passed. No money moved.' },
    REFUSED: { text: 'Refused', tone: 'red', means: 'Your rules or a safety check refused it before PayPal was ever asked.' },
    MISMATCH: { text: 'Amount didn’t match', tone: 'red', means: 'The payment request did not match the agreed deal, so the wallet stopped it. It will not be paid.' },
    FAILED: { text: 'Failed', tone: 'red', means: 'The payment failed at PayPal.' },
    VOIDED: { text: 'Hold released', tone: 'line', means: 'The hold was cancelled. Nothing was paid.' },
    AUTO_VOIDED: { text: 'Hold released', tone: 'line', means: 'The hold ran out and released itself. Nothing was paid.' },
    UNCONFIRMED: { text: 'Not confirmed by PayPal', tone: 'coral', means: 'The seller said it was paid, but this wallet has no match for it on PayPal’s statement. It moved nothing.' }
  };
  var SELLER_SAYS_PAID = 'The seller says the payment went through. Your wallet has not checked it with PayPal yet.';
  var SHIELD = {
    CLEAR: { text: 'Looks safe', tone: 'ok', means: 'No check found a reason to stop it.' },
    HOLD: { text: 'Paused for you', tone: 'gold', means: 'Paused before any PayPal call. Only you can release it, by typing the payee’s name.' },
    BLOCK: { text: 'Blocked', tone: 'red', means: 'Stopped for good. A block cannot be released.' }
  };
  var SHIELD_RULE = {
    payee_mismatch: { text: 'Different payee', tone: 'red', means: 'The money would go to someone other than the payee you agreed with.' },
    friends_and_family: { text: 'Friends & family', tone: 'red', means: 'It asks to be paid as friends & family, which has no buyer protection.' },
    no_market_reference: { text: 'No usual price', tone: 'gold', means: 'There is no recent usual price to compare it with, so the shield asks you.' },
    price_over_market: { text: 'Price far above usual', tone: 'gold', means: 'The price is more than 1.4 × the usual price.' },
    new_counterparty_over_threshold: { text: 'New payee, large amount', tone: 'gold', means: 'A payee first seen in the last 24 hours is asking for more than $100.00, so the shield asks you.' },
    model_caution: { text: 'A second look', tone: 'gold', means: 'A second look asked for caution. It can only make things safer.' }
  };

  var SAFETY_PROMISE = 'Nothing pays without you or a rule you signed. Waiting never sends money.';
  var MONEY_CHECK_PARKED = 'We couldn’t confirm a payment with PayPal. At the deadline the wallet asks PayPal what happened, and what PayPal shows decides. A payment PayPal already took stays paid. A hold PayPal shows is released at its own deadline, unless it is paid first: by you, or by your rules when it is a sale delivered at once. If PayPal shows no payment, no money moves.';

  /* ---- the six modules (their answers are counted from the world in world.js) --------------- */
  var MODULES = [
    { key: 'tables', name: 'Tables', what: 'Haggling', color: '#ef86a6', motif: 'two chairs at a small table', sub: 'Your agents bargain inside the price range you signed',
      empty: 'No haggling yet. When your negotiator opens a table, it shows here.' },
    { key: 'spend', name: 'Spend', what: 'What agents bought', color: '#5cb8f0', motif: 'a caged till / spending gate', sub: 'Every purchase checked against your rules before PayPal is asked',
      empty: 'Your agents have bought nothing yet.' },
    { key: 'counter', name: 'Counter', what: 'Your shop and prices', color: '#b7d36a', motif: 'a shop counter with a bell', sub: 'Orders at your counter and the least you’ll accept',
      empty: 'No orders at your counter yet.' },
    { key: 'book', name: 'Book', what: 'Every payment', color: '#e7dcc4', motif: 'an open ledger', sub: 'Every payment, and plain-language questions about them',
      empty: 'Nothing has been paid yet.' },
    { key: 'shield', name: 'Shield', what: 'Scam checks and holds', color: '#a58cf5', motif: 'a lantern / shield', sub: 'Checks every payment for scam signs before PayPal is asked',
      empty: 'The shield has not had to stop anything.' },
    { key: 'rescue', name: 'Rescue', what: 'Failed renewals', color: '#f5a25d', motif: 'a lifebuoy', sub: 'Failed renewals: one fix for one subscriber, or nothing',
      empty: 'No renewal has failed.' }
  ];
  var BY = { you: 'You', rule: 'A rule you signed', agent: 'Your agent', them: 'The other side', safe: 'Safe default', shield: 'The shield', paypal: 'PayPal' };

  /* ---- setup (the opening of the same surface) ----------------------------------------------- */
  var SETUP = [
    { key: 'keys', label: 'PayPal keys', lead: 'Add your PayPal sandbox keys', text: 'They let The Table work with PayPal test money. They are saved securely on this computer and never shown again.', act: 'Add PayPal keys', privileged: true },
    { key: 'rules', label: 'Your rules', lead: 'Sign your agents’ rules', text: 'How much your agents may spend, with whom, and when they must ask you first. Start from a ready-made set and check it.', act: 'Sign rules', privileged: true },
    { key: 'practice', label: 'Practice deal', lead: 'Connect the house seller', text: 'A practice shop that is always open, on test money. Share a code, match four words, then confirm.', act: 'Connect the house seller', privileged: false },
    { key: 'agent', label: 'Your agent', lead: 'Choose your agent app', text: 'The app your agents run in. Until you add one, the practice agent plays your deals.', act: 'Choose agent app', privileged: false },
    { key: 'unlock', label: 'Unlock', lead: 'Unlock approving', text: 'Approving asks for your device unlock. Unlock once now so your first approval is quick.', act: 'Unlock with your device', privileged: true }
  ];
  var STARTER_RULES = [['Limit per deal', 'up to $200.00 per purchase'], ['Ask me above', 'asks you above $250.00'], ['Daily limit', 'up to 12 deals and $900.00 a day'], ['Who they deal with', 'only wallets you connected'], ['Price range', 'most you’ll pay $340.00 · 6 offers']];
  var PAIRING = { code: '4417-82', words: ['harbor', 'velvet', 'lantern', 'orbit'] }; // sample words
  var ENGINES = [
    { id: 'app-a', name: 'Agent app found on this computer', text: 'Your agents run in it, on this computer' },
    { id: 'app-b', name: 'Another supported agent app', text: 'Install it first, then choose it here' },
    { id: 'practice', name: 'Practice agent', text: 'Fixed price rules inside your range · no agent app needed' }
  ];
  var LIMITS_ABOUT = 'One cap above all your agents’ rules. It covers money your agents pay out, across every set of rules, and can only make your rules stricter, never looser. Money coming in is never limited.';

  window.TABLE = {
    money: money, timeLeft: timeLeft, ago: ago, count: count,
    STATE: STATE, SHIELD: SHIELD, SHIELD_RULE: SHIELD_RULE, SELLER_SAYS_PAID: SELLER_SAYS_PAID,
    SAFETY_PROMISE: SAFETY_PROMISE, MONEY_CHECK_PARKED: MONEY_CHECK_PARKED, SAMPLE: 'Sample data · nothing is paid',
    MODULES: MODULES, BY: BY, SETUP: SETUP, STARTER_RULES: STARTER_RULES, PAIRING: PAIRING, ENGINES: ENGINES, LIMITS_ABOUT: LIMITS_ABOUT,
    moduleOf: function (key) { for (var i = 0; i < MODULES.length; i++) if (MODULES[i].key === key) return MODULES[i]; return null; }
  };
})();
