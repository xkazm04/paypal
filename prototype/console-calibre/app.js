/* The Seal · one sentence at a time, on a stack of security-printed sheets.
   Round 2: the front sheet owns the viewport, the seal is printed on it, and every list holds
   a busy merchant's hundreds of rows as well as a small shop's handful.
   Everything here is simulated on sample data: nothing is paid. */
(function () {
  'use strict';
  var T = window.TABLE;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var money = T.money, short = T.short;
  var T0 = Date.now();
  var elapsed = function () { return (Date.now() - T0) / 1000; };
  var RM = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var NARROW = window.matchMedia ? matchMedia('(max-width: 760px)') : { matches: false };
  var WIDE = window.matchMedia ? matchMedia('(min-width: 1700px)') : { matches: false };
  var calm = function () { return RM.matches || document.body.classList.contains('calm'); };
  var TAU = Math.PI * 2;
  var HOLD_MS = 1200;

  function store(k, v) {
    try {
      if (v === undefined) return window.localStorage.getItem(k);
      if (v === null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v);
    } catch (e) { return null; }
    return null;
  }
  function hl(s) { return esc(s).replace(/([−-]?\$[\d,]+\.\d{2})/g, '<em class="amt">$1</em>'); }
  function modColor(k) { var m = T.moduleOf(k); return m ? m.color : 'var(--steel)'; }
  function n0(n) { return n > 999 ? (n / 1000).toFixed(n > 9999 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(n); }

  /* ---------------------------------------------------------------- state */
  var S = {
    queue: T.NEEDS.slice(), cur: 0, locked: false, view: { name: 'centre' }, press: null, flash: null,
    su: { done: {}, phase: 'code', engine: null }, ask: 0, lists: {}, rule: T.RULES.length ? T.RULES[0].key : null, ledgerKeys: null
  };

  /* ---------------------------------------------------------------- generated line-work */
  function wave(R, A, n, ph, steps, A2, m) {
    var d = '';
    for (var s = 0; s <= steps; s++) {
      var t = s / steps * TAU;
      var r = R + A * Math.sin(n * t + ph) + (A2 ? A2 * Math.sin(m * t - ph * 2) : 0);
      d += (s ? 'L' : 'M') + (r * Math.cos(t)).toFixed(2) + ' ' + (r * Math.sin(t)).toFixed(2);
    }
    return d + 'Z';
  }
  var DECO = window.DECO || null; /* the theme's decoration module (deco.js); absent in the control */
  function buildSeal() {
    if (DECO) { DECO.seal($('#sealcore'), $('#brandrose'), $$('.minirose')); return; }
    var i = 0;
    function P(d) { return '<path pathLength="1" style="--i:' + (i++) + '" d="' + d + '"/>'; }
    function C(r) { return '<circle pathLength="1" style="--i:' + (i++) + '" r="' + r + '"/>'; }
    var a = '', b = '', c = '', k;
    for (k = 0; k < 12; k++) a += P(wave(44.6, 2.3, 40, k * TAU / 12, 640));
    a += C(48.8) + C(47.9) + C(41.4) + C(37.6);
    var mp = ''; for (k = 0; k < 5; k++) mp += 'SAMPLE DATA · NOTHING IS PAID · ';
    a += '<defs><path id="mpc" d="M0 -39.5 A39.5 39.5 0 1 1 -0.01 -39.5"/></defs><text><textPath href="#mpc" textLength="246" lengthAdjust="spacing">' + mp + '</textPath></text>';
    for (k = 0; k < 20; k++) b += P(wave(29.5, 6.2, 12, k * TAU / 20, 480, 1.1, 36));
    b += C(21.6);
    for (k = 0; k < 16; k++) c += P(wave(12.5, 7.6, 7, k * TAU / 16, 360));
    c += C(3.2);
    var vb = 'viewBox="-50 -50 100 100" aria-hidden="true"';
    $('#sealcore').innerHTML = '<svg class="band bA" ' + vb + '>' + a + '</svg><svg class="band bB" ' + vb + '>' + b + '</svg><svg class="band bC" ' + vb + '>' + c + '</svg>' +
      '<svg class="arc" viewBox="-50 -50 100 100" aria-hidden="true"><circle class="trk" r="52.5"/><circle class="lft" id="arcl" r="52.5" pathLength="1" transform="rotate(-90)"/></svg>';
    var br = wave(6.2, 1.6, 8, 0, 160) + wave(6.2, 1.6, 8, Math.PI, 160);
    $('#brandrose').setAttribute('d', br);
    $$('.minirose').forEach(function (p) { p.setAttribute('d', br); });
  }
  var ROSETTE = DECO ? DECO.rosette() : (function () {
    var s = '<svg viewBox="-24 -24 48 48" aria-hidden="true">';
    for (var i = 0; i < 4; i++) s += '<circle r="' + (8 + i * 4) + '"/>';
    for (i = 0; i < 4; i++) s += '<path pathLength="1" d="' + wave(8 + i * 4, 1 + i * .15, 12 + i * 6, i, 220) + '"/>';
    return s + '</svg>';
  })();
  var texCache = {};
  function tex(color, op, kind) {
    if (DECO) return DECO.tex(color, op, kind);
    var key = color + op; if (texCache[key]) return texCache[key];
    var s = "<svg xmlns='http://www.w3.org/2000/svg' width='240' height='44' viewBox='0 0 240 44'><g fill='none' stroke='" + color + "' stroke-opacity='" + op + "' stroke-width='.6'>";
    for (var k = 0; k < 6; k++) {
      var d = '';
      for (var x = 0; x <= 240; x += 4) d += (x ? 'L' : 'M') + x + ' ' + (22 + 13 * Math.sin(x / 120 * TAU + k * Math.PI / 3)).toFixed(1);
      s += "<path d='" + d + "'/>";
    }
    s += '</g></svg>';
    return (texCache[key] = 'url("data:image/svg+xml,' + encodeURIComponent(s) + '")');
  }
  var MP_LONG = new Array(24).join('SAMPLE DATA · NOTHING IS PAID · ');
  var HOURGLASS = '<svg viewBox="0 0 12 14" aria-hidden="true"><path d="M2 1h8M2 13h8M3 1c0 4 6 4 6 6s-6 2-6 6M9 1c0 4-6 4-6 6s6 2 6 6" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>';
  var MINISEAL = DECO ? DECO.miniseal() : '<svg viewBox="-12 -12 24 24" style="width:1.2rem;height:1.2rem" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width=".9"><circle r="10.5"/><path d="' + wave(6.2, 1.6, 8, 0, 120) + '"/></g></svg>';

  /* ---------------------------------------------------------------- engraved key art (stylised) */
  var GLYPH = {
    tables: '<path d="M2 3v10M2 9h3v4M14 3v10M14 9h-3v4M5 7h6M8 7v6"/>',
    spend: '<path d="M2 6h12l-1.5 7h-9zM5 6l2-4M11 6 9 2M6 8v3M8 8v3M10 8v3"/>',
    counter: '<path d="M1 13h14M2 13V9h12v4M5 9a3 3 0 0 1 6 0M8 5v1"/>',
    book: '<path d="M8 4C6 2.5 4 2.5 2 3v10c2-.5 4-.5 6 1 2-1.5 4-1.5 6-1V3c-2-.5-4-.5-6 1zM8 4v10"/>',
    shield: '<path d="M8 1.5l5.5 2v4c0 3.5-2.5 5.5-5.5 7-3-1.5-5.5-3.5-5.5-7v-4zM8 5v5M6.5 6.5h3"/>',
    rescue: '<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2.8"/><path d="M8 2v3.2M8 10.8V14M2 8h3.2M10.8 8H14"/>'
  };
  function glyph(k) { return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + GLYPH[k] + '</svg>'; }
  var artCache = {};
  function art(key) {
    if (artCache[key]) return artCache[key];
    if (DECO) return (artCache[key] = DECO.art(key, T.moduleOf(key), esc));
    var h1 = 'h1' + key, h2 = 'h2' + key, cl = 'cl' + key;
    function sh(d, h) { return '<path d="' + d + '" fill="#1c2129" stroke="none"/><path d="' + d + '" fill="url(#' + (h === 2 ? h2 : h1) + ')"/>'; }
    var sky = ''; for (var y = 14; y < 170; y += 3.4) sky += 'M10 ' + y.toFixed(1) + 'H230';
    var frame = ''; for (var s = 0; s <= 240; s++) { var t = s / 240 * TAU, rr = 1 + .022 * Math.sin(60 * t); frame += (s ? 'L' : 'M') + (120 + 112 * rr * Math.cos(t)).toFixed(1) + ' ' + (90 + 86 * rr * Math.sin(t)).toFixed(1); }
    var o = '';
    if (key === 'tables') {
      var chair = sh('M46 58C52 53 64 53 70 58L68 112H50Z', 1) + sh('M50 112H92L96 120H54Z', 2) + '<path d="M46 58 50 150M54 120l2 30M92 120l2 30M68 120l2 25M52 74h16M52 88h16M52 100h15"/>';
      o = '<path d="M60 151a60 4 0 1 0 120 0a60 4 0 1 0-120 0" fill="url(#' + h2 + ')" stroke="none"/>' + chair + '<g transform="translate(240 0) scale(-1 1)">' + chair + '</g>' +
        sh('M115 106 113 142H127L125 106Z', 2) + '<path d="M100 148 113 142M140 148 127 142M96 149h48"/>' +
        sh('M76 96a44 9 0 1 0 88 0a44 9 0 1 0-88 0', 1) + '<path d="M80 98l2 8h76l2-8"/>' +
        sh('M106 87h11l-1.5 8h-8z', 2) + '<path d="M117 89c3 0 3 4 0 4"/>' + sh('M129 95c-2-6 2-10 0-16h6c-2 6 2 10 0 16z', 2) + '<path d="M132 79c0-7 4-11 9-13M132 79c-1-7-5-10-10-11M141 66c2 0 3 1 3 3M122 68c-2 0-3 2-2 3"/>';
    } else if (key === 'spend') {
      var weave = ''; for (var x = 78; x <= 162; x += 12) weave += 'M' + x + ' 88L' + (76 + (x - 64) * (88 / 112)).toFixed(1) + ' 146';
      o = '<path d="M50 151a70 4 0 1 0 140 0a70 4 0 1 0-140 0" fill="url(#' + h2 + ')" stroke="none"/>' +
        '<path d="M84 80C84 26 156 26 156 80M92 80C92 38 148 38 148 80"/>' + sh('M98 80V56h28v24', 2) + '<path d="M98 64h28M112 56v24"/>' + sh('M134 80V62c0-4 3-6 3-10v-6h7v6c0 4 3 6 3 10v18', 1) +
        sh('M64 88H176L164 146H76Z', 1) + '<path d="' + weave + 'M70 106h100M73 124h94" stroke-width=".9"/>' + sh('M58 80h124v9H58z', 2) +
        sh('M184 146a12 3.5 0 1 0 24 0v-6a12 3.5 0 1 0-24 0z', 2) + sh('M186 134a12 3.5 0 1 0 24 0v-6a12 3.5 0 1 0-24 0z', 1) + sh('M184 122a12 3.5 0 1 0 24 0v-6a12 3.5 0 1 0-24 0z', 2) + '<path d="M184 116a12 3.5 0 1 0 24 0a12 3.5 0 1 0-24 0"/>';
    } else if (key === 'counter') {
      o = '<path d="M28 152a92 4 0 1 0 184 0a92 4 0 1 0-184 0" fill="url(#' + h2 + ')" stroke="none"/>' + sh('M38 104h164v44H38z', 1) + '<path d="M48 112h44v28H48zM98 112h44v28H98zM148 112h44v28h-44z"/>' + sh('M30 96h180v8H30z', 2) +
        sh('M100 96h40v-4h-40z', 2) + sh('M104 92C104 68 136 68 136 92Z', 2) + '<path d="M110 84c2-7 6-10 10-11" stroke-width=".9"/>' + sh('M117 70h6v-4h-6z', 1) + '<path d="M120 66v-4M146 70q7-6 5-15M153 76q11-9 9-24M94 70q-7-6-5-15M87 76q-11-9-9-24"/>' +
        sh('M164 96l8-16h20v16', 1) + '<path d="M60 96V60h22v36M64 66h14M64 72h14M64 78h10" stroke-width="1.1"/>';
    } else if (key === 'book') {
      var rules = ''; for (var r = 0; r < 8; r++) { var yy = 76 + r * 8; rules += 'M44 ' + yy + 'Q78 ' + (yy - 6) + ' 112 ' + (yy + 2); }
      var page = sh('M120 66C100 56 64 56 34 62V140C64 134 100 134 120 144Z', 2) + '<path d="' + rules + 'M98 66V138" stroke-width=".8"/>';
      o = '<path d="M40 156a80 4 0 1 0 160 0a80 4 0 1 0-160 0" fill="url(#' + h2 + ')" stroke="none"/>' + sh('M28 68V148C64 142 100 142 120 152C140 142 176 142 212 148V68', 1) + page + '<g transform="translate(240 0) scale(-1 1)">' + page + '</g>' +
        '<path d="M120 66V150"/>' + sh('M126 146v22l5-5 5 5v-22', 1) + '<path d="M150 72l6-14 3 1-6 14z"/>';
    } else if (key === 'shield') {
      var rays = ''; for (var qq = 0; qq < 12; qq++) { var an = qq / 12 * TAU; rays += 'M' + (120 + 20 * Math.cos(an)).toFixed(1) + ' ' + (84 + 20 * Math.sin(an)).toFixed(1) + 'L' + (120 + 27 * Math.cos(an)).toFixed(1) + ' ' + (84 + 27 * Math.sin(an)).toFixed(1); }
      o = sh('M120 20 178 38C178 92 162 132 120 158 78 132 62 92 62 38Z', 1) + '<path d="M120 30 168 45C168 92 154 124 120 146 86 124 72 92 72 45Z" fill="#1c2129"/>' +
        '<path d="' + rays + '" stroke-width=".9"/>' + '<path d="M114 52a6 6 0 1 1 12 0"/>' + sh('M106 64H134L128 56H112Z', 2) + sh('M108 64h24v40h-24z', 2) +
        '<path d="M108 64h24v40h-24zM116 64v40M124 64v40"/>' + '<path d="M120 74c-5 8-4 14 0 18 4-4 5-10 0-18z" fill="currentColor" fill-opacity=".85"/>' + sh('M104 104h32v6h-32z', 1);
    } else {
      var bands = '';
      [45, 135, 225, 315].forEach(function (deg) {
        var a0 = (deg - 16) * Math.PI / 180, a1 = (deg + 16) * Math.PI / 180, cx = 120, cy = 90;
        var p = function (rad, a) { return (cx + rad * Math.cos(a)).toFixed(1) + ' ' + (cy + rad * Math.sin(a)).toFixed(1); };
        bands += sh('M' + p(56, a0) + 'A56 56 0 0 1 ' + p(56, a1) + 'L' + p(26, a1) + 'A26 26 0 0 0 ' + p(26, a0) + 'Z', 1);
      });
      var rope = ''; for (var e = 0; e < 12; e++) { var b0 = e / 12 * TAU + .26, b1 = (e + 1) / 12 * TAU + .26, bm = (b0 + b1) / 2; rope += 'M' + (120 + 60 * Math.cos(b0)).toFixed(1) + ' ' + (90 + 60 * Math.sin(b0)).toFixed(1) + 'Q' + (120 + 70 * Math.cos(bm)).toFixed(1) + ' ' + (90 + 70 * Math.sin(bm)).toFixed(1) + ' ' + (120 + 60 * Math.cos(b1)).toFixed(1) + ' ' + (90 + 60 * Math.sin(b1)).toFixed(1); }
      o = '<path d="M64 90a56 56 0 1 0 112 0a56 56 0 1 0-112 0ZM94 90a26 26 0 1 1 52 0a26 26 0 1 1-52 0Z" fill="#1c2129" fill-rule="evenodd" stroke="none"/><path d="M64 90a56 56 0 1 0 112 0a56 56 0 1 0-112 0ZM94 90a26 26 0 1 1 52 0a26 26 0 1 1-52 0Z" fill="url(#' + h2 + ')" fill-rule="evenodd"/>' + bands +
        '<path d="' + rope + '" stroke-width="1.1"/><path d="M22 162q12-8 24 0t24 0 24 0 24 0 24 0 24 0 24 0 24 0M34 170q12-8 24 0t24 0 24 0 24 0 24 0 24 0 24 0" stroke-width=".9"/>';
    }
    return (artCache[key] = '<svg viewBox="0 0 240 180" role="img" aria-label="Stylised engraving: ' + esc(T.moduleOf(key).motif) + '"><defs>' +
      '<pattern id="' + h1 + '" width="2.6" height="2.6" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><path d="M0 0V2.6" stroke="currentColor" stroke-width=".6"/></pattern>' +
      '<pattern id="' + h2 + '" width="3.2" height="3.2" patternUnits="userSpaceOnUse" patternTransform="rotate(-40)"><path d="M0 0V3.2" stroke="currentColor" stroke-width=".45"/></pattern>' +
      '<clipPath id="' + cl + '"><ellipse cx="120" cy="90" rx="104" ry="80"/></clipPath></defs>' +
      '<g clip-path="url(#' + cl + ')"><path d="' + sky + '" stroke="currentColor" stroke-width=".5" opacity=".28"/></g>' +
      '<ellipse cx="120" cy="90" rx="104" ry="80" fill="none" stroke="currentColor" stroke-width="1.1" opacity=".8"/><path d="' + frame + 'Z" fill="none" stroke="currentColor" stroke-width=".6" opacity=".6"/>' +
      '<g fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round" stroke-linecap="round">' + o + '</g></svg>');
  }

  /* ---------------------------------------------------------------- words for deals */
  function person(d) { return T.personOf(d); }
  function nm(d, n) { return short(person(d).name, n || 40); }
  function bucket(d) { return T.bucket(d); }
  function stateWord(d) { return d.decided ? { text: d.decided, tone: d.decidedTone || 'teal', means: 'You decided this a moment ago. Sample data, nothing is paid.' } : T.word(d); }
  function wordHtml(w) { return '<span class="word tone-' + w.tone + ' ' + (w.cls || (w.tone === 'dashed' ? 'dashed' : w.tone === 'line' ? 'line' : '')) + '">' + esc(w.text) + '</span>'; }
  function amountHtml(d) {
    if (d.amount == null) return '<span class="amt" style="color:var(--dim);font-weight:400">no price yet</span>';
    var b = bucket(d);
    if (b === 'stopped' || b === 'closed') return '<span class="amt"><del>' + money(d.amount) + '</del></span>';
    return '<span class="amt tone-' + (b === 'paid' ? 'ok' : b === 'hold' || b === 'needs' ? 'gold' : 'teal') + '">' + money(d.amount) + '</span>';
  }
  function open(d) { return d.deadline != null && !T.ended(d) && !d.decided; }
  function leftOf(d) { var r = d.deadline - elapsed(); return r > 0 ? T.timeLeft(r) + ' left' : 'Deadline passed · its safe default applies'; }
  function whenHtml(d) {
    if (open(d)) return '<span class="when' + (S.queue.indexOf(d.key) >= 0 ? ' gold' : '') + '" data-left="' + d.key + '">' + esc(leftOf(d)) + '</span>';
    if (d.decided) return '<span class="when">just now</span>';
    if (d.updated != null) return '<span class="when">' + esc(T.ago(d.updated)) + '</span>';
    return '<span class="when"></span>';
  }
  function silenceHtml(d, big) { return d.silence ? '<p class="silence' + (big ? ' big' : '') + '">' + HOURGLASS + '<span>If you do nothing: <b>' + esc(d.silence) + '</b></span></p>' : ''; }
  function why(text, label) { return '<details class="why"><summary>' + (label || 'Why?') + '</summary><div class="pop">' + text + '</div></details>'; }
  function row(d, sub) {
    var m = T.moduleOf(d.module);
    return '<button class="srow" style="--c:' + m.color + '" data-go="deal/' + d.key + '" data-peek="' + d.key + '"><span class="dot"></span><span class="t"><b>' + esc(d.title) + '</b><span>' + esc(sub || nm(d)) + '</span></span>' +
      '<span class="wd">' + wordHtml(stateWord(d)) + '</span>' + amountHtml(d) + whenHtml(d) + '</button>';
  }

  /* ---------------------------------------------------------------- lists that hold hundreds */
  function L(id) { return S.lists[id] || (S.lists[id] = { q: '', f: 'all', n: 0, sort: 'soon', who: 'all' }); }
  var LISTS = {
    deals: function (id, base, opt) {
      return {
        page: 40, base: base, filters: T.BUCKETS, search: function (d) { return d.title + ' ' + person(d).name + ' ' + stateWord(d).text; },
        sorts: [['soon', 'Soonest first'], ['new', 'Newest'], ['big', 'Largest']],
        sort: function (a, b, s) {
          if (s === 'big') return b.amount - a.amount;
          if (s === 'new') return (b.updated || 0) - (a.updated || 0);
          var wa = a.need ? 0 : open(a) ? 1 : 2, wb = b.need ? 0 : open(b) ? 1 : 2;
          return wa - wb || (wa < 2 ? (a.deadline || 0) - (b.deadline || 0) : (b.updated || 0) - (a.updated || 0));
        },
        pred: function (d, f) { return f === 'all' || bucket(d) === f; },
        row: function (d) { return row(d, opt && opt.sub ? opt.sub(d) : null); }, peek: true, empty: 'Nothing matches. Try another word or filter.'
      };
    }
  };
  function listCfg(id) {
    var p = id.split(':');
    if (p[0] === 'm') return LISTS.deals(id, T.of(p[1]), p[1] === 'shield' ? { sub: function (d) { return nm(d, 32) + (d.shieldRule ? ' · ' + d.shieldRule.text : ''); } } : null);
    if (p[0] === 'ledger') {
      var c = LISTS.deals(id, S.ledgerKeys ? S.ledgerKeys.keys.map(T.light) : T.DEALS, { sub: function (d) { return nm(d, 34) + ' · ' + T.moduleOf(d.module).name; } });
      c.modules = true; return c;
    }
    if (p[0] === 'waiting') {
      var w = LISTS.deals(id, S.queue.map(T.light));
      w.filters = null; w.modules = true; w.sorts = null; w.sort = null;
      w.row = function (d) {
        var m = T.moduleOf(d.module), i = S.queue.indexOf(d.key);
        return '<button class="srow wrow" style="--c:' + m.color + '" data-act="pick:' + i + '" data-peek="' + d.key + '"><span class="dot"></span><span class="t"><b>' + hl(d.need.headline) + '</b><span>' + esc(nm(d, 36)) + ' · ' + esc(short(d.title, 56)) + '</span></span>' +
          '<span class="wd"><span class="chip" style="--c:' + m.color + '">' + esc(m.name) + '</span></span><span class="amt tone-gold">' + money(d.amount) + '</span>' + whenHtml(d) + '</button>';
      };
      return w;
    }
    if (p[0] === 'rewind') {
      var whoF = [['you', 'You'], ['rule', 'Your rules'], ['safe', 'Safe default'], ['paypal', 'PayPal'], ['them', 'The other side'], ['agent', 'Your agents'], ['shield', 'The shield']];
      return {
        page: 60, base: T.steps(), filters: whoF, search: function (s) { return s.title + ' ' + s.text; }, pred: function (s, f) { return f === 'all' || s.by === f; },
        tape: true, empty: 'Nothing here.',
        row: function (s) {
          return '<li><button class="tone-' + s.tone + (s.tone === 'dashed' ? ' dashed' : s.tone === 'line' ? ' line' : '') + '" data-go="deal/' + s.key + '"><span class="tm">' + esc(T.ago(s.at)) + '<br>' + esc(T.BY[s.by]) + '</span><span class="tx"><span class="tt">' + esc(short(s.title, 64)) + '</span>' + hl(s.text) + '</span></button></li>';
        }
      };
    }
    if (p[0] === 'record') {
      var all = []; for (var i = 0; i < T.RECORD.size; i++) all.push(i);
      return {
        page: 60, base: all, filters: [['you', 'You'], ['rule', 'Your rules'], ['agent', 'Your agents'], ['wallet', 'The wallet'], ['money', 'Asked PayPal']],
        search: function (i) { var r = T.RECORD.row(i); return r.whoText + ' ' + r.what + ' ' + r.title; },
        pred: function (i, f) { if (f === 'all') return true; var r = T.RECORD.row(i); return f === 'money' ? r.money : r.who === f; }, empty: 'Nothing matches.',
        row: function (i) {
          var r = T.RECORD.row(i);
          var inner = '<span class="tm">' + esc(T.ago(r.at)) + '</span><span class="rw ' + r.who + '">' + esc(r.whoText) + '</span><span class="tx">' + esc(r.what) + (r.dec ? ' <small>· ' + esc(r.dec) + '</small>' : '') + (r.title ? '<small class="ti">' + esc(short(r.title, 70)) + '</small>' : '') + '</span>' + (r.money ? '<span class="word tone-gold">PayPal</span>' : '<span></span>');
          return r.key ? '<button class="rrow" data-go="deal/' + r.key + '">' + inner + '</button>' : '<div class="rrow">' + inner + '</div>';
        }
      };
    }
    if (p[0] === 'people') {
      var subs = p[1] === 'subs', ppl = Object.keys(T.PEOPLE).map(function (k) { return T.PEOPLE[k]; }).filter(function (x) { return x.sub === subs; });
      return {
        page: 40, base: ppl, search: function (x) { return x.name + ' ' + x.payee; }, pred: function () { return true; },
        sorts: [['closed', 'Most deals'], ['name', 'Name'], ['new', 'Newest']],
        sort: function (a, b, s) { return s === 'name' ? a.name.localeCompare(b.name) : s === 'new' ? b.since - a.since : b.closed - a.closed; }, empty: 'Nobody matches.',
        row: function (x) {
          return '<div class="lrow prow"><span class="pn"><b>' + esc(x.name) + '</b><small>pays to ' + esc(x.payee) + ' · connected ' + esc(T.ago(x.since)) + ' · ' + T.count(x.closed, 'deal') + ' closed</small></span><span class="word tone-' + (x.house ? 'teal' : x.verified === 'Not connected' ? 'line' : 'ok') + '">' + esc(x.verified) + '</span></div>';
        }
      };
    }
    return null;
  }
  function listItems(id) {
    var c = listCfg(id), st = L(id), q = st.q.trim().toLowerCase();
    var items = c.base.filter(function (x) {
      if (!x) return false;
      if (c.modules && st.mod && st.mod !== 'all' && x.module !== st.mod) return false;
      if (c.filters && !c.pred(x, st.f)) return false;
      return !q || c.search(x).toLowerCase().indexOf(q) >= 0;
    });
    if (c.sort) { var srt = st.sort === 'soon' && c.sorts && c.sorts[0][0] !== 'soon' ? c.sorts[0][0] : st.sort; items.sort(function (a, b) { return c.sort(a, b, srt); }); }
    return { c: c, st: st, items: items };
  }
  function listBlock(id, opts) {
    opts = opts || {};
    var r = listItems(id), c = r.c, st = r.st, total = c.base.length, few = total <= 8;
    var tb = '';
    if (!few || opts.toolbar) {
      tb += '<div class="toolbar" data-list="' + id + '"><label class="search"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.4 10.4 14 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg><input type="search" data-q="' + id + '" value="' + esc(st.q) + '" placeholder="' + esc(opts.ph || 'Search ' + n0(total) + (opts.noun ? ' ' + opts.noun : '')) + '" aria-label="Search this list"></label>';
      if (c.filters) {
        tb += '<div class="seg" role="group" aria-label="Show">' + [['all', 'All']].concat(c.filters).map(function (f) {
          var n = f[0] === 'all' ? total : c.base.filter(function (x) { return x && c.pred(x, f[0]); }).length;
          if (!n && f[0] !== 'all') return '';
          return '<button data-f="' + id + ':' + f[0] + '" aria-pressed="' + (st.f === f[0]) + '"' + (f[0] === 'needs' ? ' class="g"' : '') + '>' + esc(f[1]) + ' <i>' + n0(n) + '</i></button>';
        }).join('') + '</div>';
      }
      if (c.modules) {
        var mods = T.MODULES.filter(function (m) { return m.key !== 'book' && c.base.some(function (x) { return x && x.module === m.key; }); });
        if (mods.length > 1) tb += '<div class="seg mods" role="group" aria-label="Layer">' + [{ key: 'all', name: 'Every layer', color: 'var(--steel)' }].concat(mods).map(function (m) {
          var n = m.key === 'all' ? total : c.base.filter(function (x) { return x && x.module === m.key; }).length;
          return '<button data-mod="' + id + ':' + m.key + '" style="--c:' + m.color + '" aria-pressed="' + ((st.mod || 'all') === m.key) + '">' + esc(m.name) + ' <i>' + n0(n) + '</i></button>';
        }).join('') + '</div>';
      }
      if (c.sorts) tb += '<label class="sortby"><span class="vh">Sort</span><select data-sort="' + id + '">' + c.sorts.map(function (s) { return '<option value="' + s[0] + '"' + (st.sort === s[0] ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') + '</select></label>';
      tb += '</div>';
    }
    var peek = c.peek && WIDE.matches && !NARROW.matches && total > 0;
    return '<div class="lst' + (peek ? ' withpeek' : '') + '" id="lst-' + id.replace(/[^a-z0-9]/gi, '_') + '">' + tb + '<div class="lbody"><div class="rowsw">' + rowsHtml(id, r) + '</div>' + (peek ? '<aside class="peek" aria-live="polite"></aside>' : '') + '</div></div>';
  }
  function rowsHtml(id, r) {
    r = r || listItems(id);
    var c = r.c, st = r.st, page = c.page, n = st.n || page, shown = r.items.slice(0, n);
    var body = shown.map(c.row).join('');
    var wrapOpen = c.tape ? '<ol class="tape">' : '<div class="statement">', wrapClose = c.tape ? '</ol>' : '</div>';
    var meta = '<p class="lmeta">' + (r.items.length === c.base.length ? 'Showing ' + n0(shown.length) + ' of ' + n0(r.items.length) : n0(r.items.length) + ' match · showing ' + n0(shown.length)) + '</p>';
    var more = r.items.length > shown.length ? '<button class="btn more" data-more="' + id + '">Show ' + Math.min(page, r.items.length - shown.length) + ' more <small>' + n0(r.items.length - shown.length) + ' left</small></button>' : '';
    if (!r.items.length) return '<p class="calm">' + esc(c.empty) + '</p>';
    return (c.base.length > 8 ? meta : '') + wrapOpen + body + wrapClose + more;
  }
  function refreshList(id, keepFocus) {
    var box = $('#lst-' + id.replace(/[^a-z0-9]/gi, '_')); if (!box) return;
    var r = listItems(id);
    $('.rowsw', box).innerHTML = rowsHtml(id, r);
    $$('[data-f]', box).forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.f === id + ':' + r.st.f)); });
    $$('[data-mod]', box).forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.mod === id + ':' + (r.st.mod || 'all'))); });
    firstPeek(box);
    if (keepFocus) keepFocus.focus();
  }
  function firstPeek(box) { var pk = $('.peek', box), f = $('[data-peek]', box); if (pk) pk.innerHTML = f ? peekHtml(T.deal(f.dataset.peek)) : ''; }
  function peekHtml(d) {
    var m = T.moduleOf(d.module), w = stateWord(d), st = d.story.slice(-5);
    return '<p class="kicker" style="color:' + m.color + '">' + esc(m.name) + ' · ' + esc(d.side === 'selling' ? 'selling to' : 'buying from') + '</p><p class="pn">' + esc(person(d).name) + '</p>' +
      '<h3 class="ptitle">' + esc(d.title) + '</h3><div class="pline">' + amountHtml(d) + wordHtml(w) + '</div>' + (open(d) ? silenceHtml(d) : '') +
      '<p class="h3">Latest</p><ol class="story mini">' + st.map(function (s) { return '<li><span class="by by-' + s[1] + '">' + esc(T.BY[s[1]]) + '<span class="tm">' + esc(T.ago(s[0] - elapsed())) + '</span></span><span>' + hl(s[2]) + '</span></li>'; }).join('') + '</ol>' +
      '<button class="btn steel sm" data-go="deal/' + d.key + '">Open the deal ›</button>';
  }

  /* ---------------------------------------------------------------- views */
  function V(name, extra) { var v = { name: name }; if (extra) for (var k in extra) v[k] = extra[k]; return v; }
  function parentOf(v) {
    if (v.from) return v.from;
    switch (v.name) {
      case 'centre': return null;
      case 'setup': return v.layer ? V('settings') : null;
      case 'deal': return V('module', { key: T.light(v.key).module });
      case 'ledger': case 'ask': case 'record': return V('module', { key: 'book' });
      case 'limits': return V('rules');
      default: return V('centre');
    }
  }
  function chain(v) { var c = []; while (v) { c.unshift(v); v = parentOf(v); } return c; }
  function level(v) { return chain(v).length; }
  function labelOf(v) {
    switch (v.name) {
      case 'centre': return 'What needs you';
      case 'setup': return v.layer ? 'Setup' : 'Your charter';
      case 'module': return T.moduleOf(v.key).name;
      case 'deal': return short(T.light(v.key).title, 34);
      case 'ledger': return 'Ledger';
      case 'record': return 'The record';
      case 'ask': return 'Ask your book';
      case 'rules': return 'Rules';
      case 'limits': return 'Wallet limits';
      case 'connections': return 'Connections';
      case 'settings': return 'Settings';
      case 'rewind': return 'Rewind';
      case 'waiting': return 'Everything waiting';
    }
    return '';
  }
  function toHash(v) {
    switch (v.name) {
      case 'setup': return v.layer ? 'setup/again' : 'setup';
      case 'module': return 'm/' + v.key;
      case 'deal': return 'm/' + T.light(v.key).module + '/' + v.key;
      case 'ledger': return 'book/ledger';
      case 'record': return 'book/record';
      case 'ask': return 'book/ask';
      case 'limits': return 'rules/limits';
      default: return v.name;
    }
  }
  function fromHash(h) {
    var p = String(h || '').replace(/^#/, '').split('/');
    switch (p[0]) {
      case 'centre': return V('centre');
      case 'setup': return V('setup', p[1] === 'again' ? { layer: true } : null);
      case 'm':
        if (p[2] && T.light(p[2])) return V('deal', { key: p[2] });
        if (T.moduleOf(p[1])) return V('module', { key: p[1] });
        return V('centre');
      case 'deal': return T.light(p[1]) ? V('deal', { key: p[1], from: S.view }) : null;
      case 'book': return p[1] === 'ledger' ? V('ledger') : p[1] === 'ask' ? V('ask') : p[1] === 'record' ? V('record') : V('module', { key: 'book' });
      case 'rules': return p[1] === 'limits' ? V('limits') : V('rules');
      case 'connections': case 'settings': case 'rewind': case 'waiting': return V(p[0]);
      case 'approve': return V('centre', { approve: p[1] });
    }
    return null;
  }
  function setHash() {
    var h = toHash(S.view);
    if (S.press && S.press.mode === 'deal') h = 'approve/' + S.press.key;
    try { history.replaceState(null, '', location.pathname + location.search + '#' + h); } catch (e) { /* file:// may refuse */ }
  }

  /* centre: the decision, one sentence, the seal printed beside it */
  function curDeal() { return S.queue.length ? T.deal(S.queue[S.cur]) : null; }
  function factCells(d) {
    var n = d.need, rs = d.rules || [], asks = rs.filter(function (r) { return r.result === 'asks'; }).length, stops = rs.filter(function (r) { return r.result === 'stop'; }).length;
    var cells = [];
    cells.push('<div class="fact"><span class="fl">' + (n.kind === 'fix' ? 'The fix' : n.kind === 'payhold' ? 'On hold at PayPal' : 'Amount') + '</span><span class="fv gold">' + money(d.amount) + '</span>' +
      (n.kind === 'fix' && d.fix ? '<span class="fs"><del>' + money(d.fix.was) + '</del> · ' + esc(d.fix.lever) + '</span>' : '<span class="fs">' + esc(d.side === 'selling' ? 'from ' : 'to ') + esc(nm(d, 30)) + '</span>') + '</div>');
    if (d.market) cells.push('<div class="fact"><span class="fl">Against the market</span><span class="fv">' + esc(d.market.words) + '</span><span class="fs">usually ' + money(d.market.low) + '–' + money(d.market.high) + (d.qty > 1 ? ' each' : '') + '</span></div>');
    else if (d.shieldRule) cells.push('<div class="fact"><span class="fl">The shield</span><span class="fv">' + esc(d.shieldRule.text) + '</span><span class="fs">' + esc(short(d.shieldRule.means, 70)) + '</span></div>');
    else cells.push('<div class="fact"><span class="fl">Now</span><span class="fv">' + esc(stateWord(d).text) + '</span><span class="fs">' + esc(short(stateWord(d).means, 70)) + '</span></div>');
    cells.push('<div class="fact"><span class="fl">Your rules</span><span class="fv">' + (rs.length - asks - stops) + ' passed' + (asks ? ' · <b class="tone-gold">' + asks + ' asks you</b>' : '') + (stops ? ' · <b class="tone-red">' + stops + ' stopped it</b>' : '') + '</span><span class="fs">' + esc(rs.length ? (rs.filter(function (r) { return r.result !== 'pass'; })[0] || rs[0]).why : 'No rule had to decide') + '</span></div>');
    return '<div class="facts">' + cells.join('') + '</div>';
  }
  var TONE_C = { ok: 'var(--ok)', teal: 'var(--teal)', gold: 'var(--gold)', red: 'var(--red)', line: 'var(--steel)', dashed: 'var(--dim)' };
  function alsoWaiting() {
    var len = S.queue.length; if (len < 1) return '';
    var k = NARROW.matches ? 2 : WIDE.matches ? 6 : 4, out = [], nq = Math.min(k, len - 1);
    for (var i = 1; i <= nq; i++) {
      var idx = (S.cur + i) % len, d = T.light(S.queue[idx]), m = T.moduleOf(d.module);
      out.push('<button class="wcard" style="--c:' + m.color + '" data-act="pick:' + idx + '"><span class="wk">' + esc(m.name) + (d.deadline != null ? ' · <span data-left="' + d.key + '">' + esc(leftOf(d)) + '</span>' : '') + '</span><b>' + hl(d.need.headline) + '</b><span class="wn">' + esc(nm(d, 34)) + '</span></button>');
    }
    /* a short stack leaves room: fill it with what happened while you were away and what the wallet watches */
    var fill = T.AWAY.lines.map(function (l) { return { c: TONE_C[l.tone] || TONE_C.line, k: 'While you were away', t: l.text, go: 'rewind' }; })
      .concat((T.WATCHES || []).map(function (w) { return { c: TONE_C[w.tone] || TONE_C.line, k: 'Watching · ' + w.plan, t: w.who + ': ' + w.state, go: 'm/rescue' }; }));
    for (var j = 0; out.length < (NARROW.matches ? nq : k) && j < fill.length; j++) {
      var f = fill[j];
      out.push('<button class="wcard wfill" style="--c:' + f.c + '" data-go="' + f.go + '" title="' + esc(f.t) + '"><span class="wk">' + esc(f.k) + '</span><b>' + hl(f.t) + '</b></button>');
    }
    if (!out.length) return '';
    var head = nq ? 'Next in the stack' : 'Nothing else waits · while you were away';
    var btn = len > 1 ? '<button class="btn sm steel" data-go="waiting">All ' + len + ' waiting ›</button>' : '<button class="btn sm steel" data-go="rewind">Rewind ›</button>';
    return '<div class="also"><div class="alsoh"><span class="h3">' + head + '</span><span class="sp"></span>' + btn + '</div><div class="wcards">' + out.join('') + '</div></div>';
  }
  function vCentre() {
    var d = curDeal();
    if (!d) {
      return { c: 'var(--steel)', mode: 'centre', html: '<div class="cgrid"><div class="cmain"><div class="toprow"><span class="stackidx">The stack is clear</span></div><p class="kicker">Nothing needs you</p>' +
        '<h1 class="display" id="front-title" tabindex="-1">Nothing needs you. If you do nothing, no money moves.</h1><p class="who">' + esc(T.SAFETY_PROMISE) + '</p>' +
        '<div class="acts"><button class="btn steel" data-go="rewind">See what happened while you were away</button><button class="btn quiet" data-go="m/book">Open the Book</button></div></div><div class="cseal"></div></div>' };
    }
    var n = d.need, m = T.moduleOf(d.module), p = person(d), len = S.queue.length;
    var ticks = ''; for (var i = 0; i < Math.min(len, 6); i++) ticks += '<i class="' + (i === Math.min(S.cur, 5) ? 'on' : '') + '"></i>';
    var primary;
    if (n.kind === 'approve') primary = '<button class="btn gold big" data-act="press:' + d.key + '">' + MINISEAL + ' Review &amp; approve</button>';
    else if (n.kind === 'payhold') primary = '<button class="btn gold big" data-act="press:' + d.key + '">' + MINISEAL + ' Pay or release ' + money(d.amount) + '</button>';
    else if (n.kind === 'shield') primary = '<button class="btn gold big" data-act="press:' + d.key + '">' + MINISEAL + ' Review the paused payment</button>';
    else if (n.kind === 'fix') primary = '<button class="btn gold big" data-act="press:' + d.key + '">' + MINISEAL + ' Review the fix ' + money(d.fix ? d.fix.now : d.amount) + '</button>';
    else primary = '<button class="btn steel big" data-go="deal/' + d.key + '">Open</button><button class="btn quiet" data-act="seen">Seen it, put it away</button>';
    var html = '<div class="cgrid"><div class="cmain"><div class="toprow"><span class="stackidx" aria-label="Decision ' + (S.cur + 1) + ' of ' + len + '"><span class="tk">' + ticks + '</span><b>' + (S.cur + 1) + '</b> of ' + len + '</span>' +
      '<span class="chip" style="--c:' + m.color + '">' + esc(m.name) + '</span>' +
      (d.deadline != null ? '<span class="left" data-left="' + d.key + '">' + esc(leftOf(d)) + '</span>' : '<span class="left dim">no deadline</span>') + '</div>' +
      '<p class="kicker">' + hl(n.headline) + '</p>' +
      '<h1 class="display" id="front-title" tabindex="-1">' + hl(n.ask) + '</h1>' +
      '<p class="who"><span>' + esc(p.name) + '</span> · ' + esc(d.title) + '</p>' + silenceHtml(d, true) +
      '<div class="acts">' + primary + '<button class="btn quiet" data-act="later">Later</button>' +
      (n.kind !== 'watch' ? '<button class="btn quiet" data-go="deal/' + d.key + '">Open the deal</button>' : '') + why(esc(n.why)) + '</div>' + factCells(d) + '</div><div class="cseal"></div></div>';
    var also = alsoWaiting(); html += also;
    var after = len > 1 ? '<div class="pagers"><button class="pager prev" data-act="prev" aria-label="Previous decision (Left arrow)">‹</button><button class="pager next" data-act="next" aria-label="Next decision (Right arrow)">›</button></div>' : '';
    return { c: m.color, html: html, after: after, mode: 'centre' + (also ? ' hasalso' : '') };
  }

  function vWaiting() {
    var groups = {}; S.queue.forEach(function (k) { var kind = T.light(k).need.kind; groups[kind] = (groups[kind] || 0) + 1; });
    var KW = { approve: 'to approve', payhold: 'holds to pay or release', fix: 'fixes for failed renewals', shield: 'paused by the shield', watch: 'stopped or being checked, nothing to do' };
    return { c: 'var(--gold)', html: '<div class="lhead"><div><p class="kicker">What needs you · soonest first</p><h1 class="display" id="front-title" tabindex="-1">' + S.queue.length + ' things wait for you. None of them moves money while it waits.</h1>' +
      '<p class="sub">' + Object.keys(groups).map(function (k) { return groups[k] + ' ' + KW[k]; }).join(' · ') + '</p></div></div>' + listBlock('waiting', { noun: 'waiting', toolbar: S.queue.length > 5 }) };
  }

  function statsHtml(m) {
    if (!m.stats || !m.stats.length) return '';
    var L2 = { needs: ['Need you', 'gold'], progress: ['In progress', 'teal'], paid: ['Paid', 'ok'], stopped: ['Stopped or ended', 'line'] };
    return '<div class="mstats">' + m.stats.map(function (s) { var l = L2[s[0]]; return '<button class="mstat ' + l[1] + '" data-act="mfilter:' + m.key + ':' + (s[0] === 'stopped' ? 'stopped' : s[0]) + '"' + (s[1] ? '' : ' disabled') + '><b>' + n0(s[1]) + '</b><span>' + l[0] + '</span></button>'; }).join('') + '</div>';
  }
  function vModule(key) {
    if (key === 'book') return vBook();
    var m = T.moduleOf(key), ds = T.of(key);
    var head = '<div class="lhead mod"><div class="art" style="--c:' + m.color + '">' + art(key) + '</div><div class="lht"><p class="kicker">' + esc(m.name) + ' · ' + esc(m.what) + '</p>' +
      '<h1 class="display" id="front-title" tabindex="-1">' + hl(m.answer) + '</h1><p class="sub">' + esc(m.sub) + '</p></div>' + statsHtml(m) + '</div>';
    if (!ds.length) return { c: m.color, fit: true, html: head + '<p class="calm">' + esc(m.empty) + ' If nothing happens here, no money moves.</p>' };
    var extra = '';
    if (key === 'shield') extra = '<div class="mini">' + why(Object.keys(T.SHIELD).map(function (k) { return '<p style="margin:.2rem 0"><b>' + esc(T.SHIELD[k].text) + '</b> · ' + esc(T.SHIELD[k].means) + '</p>'; }).join(''), 'What the shield’s words mean') + '</div>';
    if (key === 'rescue' && T.WATCHES.length) extra = '<details class="rset watches"><summary><span class="word tone-teal"></span><span><b>Watching ' + T.count(T.WATCHES.length, 'subscription') + ' for failed renewals</b><br><span>checking never moves money</span></span><span>›</span></summary><div class="wgrid">' + T.WATCHES.map(function (w) {
      return '<div class="lrow"><span>' + esc(w.plan) + ' <small>' + esc(w.who) + '</small></span><span class="word tone-' + w.tone + '">' + esc(w.state) + '</span></div>'; }).join('') + '</div></details>';
    var group = key === 'tables' ? ds.filter(function (d) { return T.deal(d.key).group; })[0] : null;
    if (group) extra += '<p class="note-line">Shopping around: one item at ' + (group.group.length + 1) + ' sellers’ tables. <button class="linkish" data-go="deal/' + group.key + '">Open it ›</button></p>';
    return { c: m.color, html: head + extra + listBlock('m:' + key, { noun: key === 'rescue' ? 'renewals' : 'deals' }), fit: ds.length <= 3 };
  }

  function weekBars() {
    var W = T.WEEK, max = Math.max.apply(null, W.byDay.concat(W.inByDay)) || 1, s = '';
    W.labels.forEach(function (dn, i) {
      var x = 14 + i * 41, ho = W.byDay[i] / max * 56, hi = W.inByDay[i] / max * 56;
      s += '<line x1="' + (x - 4) + '" x2="' + (x + 28) + '" y1="80" y2="80" style="stroke:var(--line2)"/>';
      if (ho) s += '<rect x="' + x + '" y="' + (80 - ho) + '" width="11" height="' + ho + '" style="fill:var(--ok)" rx="1"/>';
      if (hi) s += '<rect x="' + (x + 13) + '" y="' + (80 - hi) + '" width="11" height="' + hi + '" fill="none" style="stroke:var(--ok)" stroke-dasharray="2 1.5" rx="1"/>';
      s += '<text x="' + (x + 12) + '" y="94" text-anchor="middle" style="fill:var(--muted)" font-size="9.5">' + dn + '</text>';
    });
    var tbl = '<table class="daytbl"><thead><tr><th></th>' + W.labels.map(function (l) { return '<th>' + l + '</th>'; }).join('') + '</tr></thead><tbody><tr><th>Out</th>' + W.byDay.map(function (v) { return '<td>' + (v ? money(v) : '–') + '</td>'; }).join('') + '</tr><tr><th>In</th>' + W.inByDay.map(function (v) { return '<td>' + (v ? money(v) : '–') + '</td>'; }).join('') + '</tr></tbody></table>';
    return '<div class="scale"><svg viewBox="0 0 300 100" role="img" aria-label="Paid out and paid in by day this week">' + s + '</svg></div><p class="legend"><span class="word tone-ok">paid out</span> <span class="word tone-ok dashed">paid in</span></p>' + tbl;
  }
  function vBook() {
    var m = T.moduleOf('book'), W = T.WEEK;
    return { c: m.color, html: '<div class="lhead mod"><div class="art" style="--c:' + m.color + '">' + art('book') + '</div><div class="lht"><p class="kicker">Book · Every payment</p>' +
      '<h1 class="display" id="front-title" tabindex="-1">' + hl(W.headline) + '</h1><p class="sub">' + hl(W.sub) + '</p></div></div>' +
      '<div class="bookgrid"><div><div class="figs">' +
      '<div class="fig"><div class="v" style="color:var(--ok)">' + money(W.paidOut) + '</div><div class="l">Paid out · ' + T.count(W.nOut, 'payment') + '</div></div>' +
      '<div class="fig"><div class="v" style="color:var(--ok)">' + money(W.paidIn) + '</div><div class="l">Paid in · ' + T.count(W.nIn, 'payment') + '</div></div>' +
      '<div class="fig"><div class="v" style="color:var(--gold-l)">' + money(W.onHold) + '</div><div class="l"><span class="word tone-gold">On hold at PayPal</span></div></div>' +
      '<div class="fig"><div class="v">' + money(W.checking) + '</div><div class="l"><span class="word tone-dashed dashed">Checking with PayPal</span></div></div></div>' +
      '<div class="doors"><button class="door" data-go="book/ledger"><b>The ledger</b><span>Every deal and where its money is · ' + n0(T.DEALS.length) + ' deals</span></button>' +
      '<button class="door" data-go="book/record"><b>The record</b><span>Every step, who took it, under which authority · ' + n0(T.RECORD.size) + ' steps</span></button>' +
      '<button class="door" data-go="book/ask"><b>Ask your book</b><span>' + T.ASK.length + ' plain questions, answered from the ledger</span></button></div></div>' +
      '<div><p class="h3">This week, by day</p>' + weekBars() + '<div class="mini"><button class="btn sm" data-act="ledgerf:progress">' + W.inProgress + ' in progress</button><button class="btn sm" data-act="ledgerf:stopped">' + W.stopped + ' stopped for safety this week</button></div></div></div>' };
  }
  function vLedger() {
    var lk = S.ledgerKeys;
    return { c: T.moduleOf('book').color, html: '<div class="lhead"><div><p class="kicker">Book · Ledger' + (lk ? ' · ' + esc(lk.label) : '') + '</p><h1 class="display" id="front-title" tabindex="-1">' + (lk ? esc(lk.label) : 'Every deal, and where its money is.') + '</h1>' +
      (lk ? '<p class="sub"><button class="linkish" data-act="ledgerall">Show every deal instead ›</button></p>' : '') + '</div></div>' + listBlock('ledger', { noun: 'deals', toolbar: true }) };
  }
  function vRecord() {
    return { c: T.moduleOf('book').color, html: '<div class="lhead"><div><p class="kicker">Book · The record</p><h1 class="display" id="front-title" tabindex="-1">Every step, newest first. The record cannot be edited.</h1>' +
      '<p class="sub">Steps marked PayPal are the only times PayPal was asked to do something, and each one names its authority.</p></div></div>' + listBlock('record', { noun: 'steps', toolbar: true }) };
  }
  function vAsk() {
    var q = T.ASK[S.ask] || T.ASK[0], ks = q.keys.slice(0, 6);
    return { c: T.moduleOf('book').color, html: '<div class="askgrid"><div><p class="kicker">Book · Ask your book</p><div class="asklist" role="group" aria-label="Questions">' + T.ASK.map(function (x, i) { return '<button class="askq" data-act="ask:' + i + '" aria-pressed="' + (i === S.ask) + '">' + esc(x.q) + '</button>'; }).join('') + '</div></div>' +
      '<div><h1 class="display" id="front-title" tabindex="-1">' + esc(q.q) + '</h1><p class="answer">' + hl(q.a) + '</p>' + (ks.length ? '<p class="h3">The deals behind this answer</p><div class="statement">' + ks.map(function (k) { return row(T.light(k)); }).join('') + '</div>' +
        (q.keys.length > ks.length ? '<button class="btn more" data-act="askall">Open all ' + q.keys.length + ' in the ledger ›</button>' : '') : '') + '</div></div>' };
  }

  function scaleSvg(d) {
    var mk = d.market; if (!mk) return '';
    var val = d.unit;
    var lo = Math.min(mk.low, val) * .96, hi = Math.max(mk.high, val) * 1.04;
    var X = function (v) { return 16 + (v - lo) / (hi - lo) * 268; };
    var hatch = ''; for (var x = X(mk.low); x < X(mk.high); x += 2.4) hatch += 'M' + x.toFixed(1) + ' 31v8';
    var vx = X(val), anc = vx < 60 ? 'start' : vx > 240 ? 'end' : 'middle';
    var s = '<line x1="16" x2="284" y1="35" y2="35" style="stroke:var(--line2)"/><path d="' + hatch + '" style="stroke:var(--market)" stroke-width=".5" opacity=".7"/>' +
      '<line x1="' + X(mk.low) + '" x2="' + X(mk.low) + '" y1="29" y2="41" style="stroke:var(--market)"/><line x1="' + X(mk.high) + '" x2="' + X(mk.high) + '" y1="29" y2="41" style="stroke:var(--market)"/>' +
      '<line x1="' + X(mk.typical) + '" x2="' + X(mk.typical) + '" y1="26" y2="44" style="stroke:var(--text)" stroke-width="1.4"/>' +
      '<text x="' + X(mk.low) + '" y="55" style="fill:var(--muted)" font-size="9.5" text-anchor="middle">' + money(mk.low) + '</text><text x="' + X(mk.high) + '" y="55" style="fill:var(--muted)" font-size="9.5" text-anchor="middle">' + money(mk.high) + '</text>' +
      '<text x="' + X(mk.typical) + '" y="67" style="fill:var(--steel)" font-size="9.5" text-anchor="middle">typical ' + money(mk.typical) + '</text>' +
      '<path d="M' + (vx - 5) + ' 18L' + (vx + 5) + ' 18L' + vx + ' 27Z" style="fill:var(--gold)"/><text x="' + vx + '" y="12" style="fill:var(--gold-l)" font-size="10.5" font-weight="600" text-anchor="' + anc + '">' + (d.qty > 1 ? 'this price ' + money(val) + ' each' : 'this price ' + money(val)) + '</text>';
    return '<div class="scale"><svg viewBox="0 0 300 70" role="img" aria-label="Price against the market">' + s + '</svg></div><p class="legend">' + esc(mk.words) + ' · usually ' + money(mk.low) + '–' + money(mk.high) + '</p>';
  }
  function ladderSvg(d) {
    var Lr = d.ladder; if (!Lr || Lr.length < 2) return '';
    var vals = Lr.map(function (x) { return x[2]; }); if (d.range && d.range.most) vals.push(d.range.most);
    var lo = Math.min.apply(null, vals) * .98, hi = Math.max.apply(null, vals) * 1.01, n = Lr.length;
    var X = function (i) { return 18 + i / (n - 1) * 250; }, Y = function (v) { return 112 - (v - lo) / (hi - lo) * 92; };
    var you = [], them = [], dots = '', r = n > 30 ? 1.5 : 2.6;
    Lr.forEach(function (x, i) { var pt = X(i).toFixed(1) + ',' + Y(x[2]).toFixed(1); (x[1] === 'you' ? you : them).push(pt); dots += '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(x[2]).toFixed(1) + '" r="' + r + '" style="fill:var(--' + (x[1] === 'you' ? 'teal' : 'coral') + ')"/>'; });
    var s = '';
    if (d.range && d.range.most) s += '<line x1="10" x2="290" y1="' + Y(d.range.most) + '" y2="' + Y(d.range.most) + '" style="stroke:var(--teal-l)" stroke-dasharray="3 3" opacity=".7"/><text x="290" y="' + (Y(d.range.most) - 4) + '" style="fill:var(--teal-l)" font-size="9.5" text-anchor="end">most you’ll pay ' + money(d.range.most) + '</text>';
    s += '<polyline points="' + them.join(' ') + '" fill="none" style="stroke:var(--coral)" stroke-width="1.4"/><polyline points="' + you.join(' ') + '" fill="none" style="stroke:var(--teal)" stroke-width="1.4"/>' + dots;
    var f = Lr[0], z = Lr[n - 1];
    s += '<text x="' + X(0) + '" y="' + (Y(f[2]) - 6) + '" style="fill:var(--coral-l)" font-size="9.5">' + money(f[2]) + '</text><text x="' + X(n - 1) + '" y="' + (Y(z[2]) + 15) + '" style="fill:var(--gold-l)" font-size="10" font-weight="600" text-anchor="end">' + money(z[2]) + '</text>';
    return '<div class="ladder"><svg viewBox="0 0 300 124" role="img" aria-label="The haggle, offer by offer">' + s + '</svg></div><p class="legend"><span class="word tone-teal">your offers</span> <span class="word tone-coral">their offers</span> <span style="color:var(--dim)">' + n + ' offers' + (d.range && d.range.rounds ? ' · your rules allow ' + d.range.rounds + ' rounds' : '') + '</span></p>';
  }
  function charter(rules) {
    if (!rules || !rules.length) return '<p class="calm">No rule had to decide on this deal.</p>';
    var M = { pass: ['✓', 'ok', 'passed'], asks: ['?', 'gold', 'asked you'], stop: ['✕', 'red', 'stopped it'] };
    return '<ul class="charter">' + rules.map(function (r) { var k = M[r.result] || M.pass;
      return '<li><span class="mark tone-' + k[1] + '" aria-hidden="true">' + k[0] + '</span><span><span class="nm">' + esc(r.name) + '</span><span class="says">' + esc(r.says) + '</span>' + (r.full && r.full.length > 3 ? '<details class="more"><summary>All ' + r.full.length + '</summary><span class="says">' + esc(r.full.join(', ')) + '</span></details>' : '') + '</span><span class="res tone-' + k[1] + '">' + k[2] + '<span class="rwhy">' + esc(r.why) + '</span></span></li>'; }).join('') + '</ul>';
  }
  function storyHtml(d) {
    if (!d.story.length) return '<p class="calm">No steps recorded yet.</p>';
    return '<ol class="story">' + d.story.map(function (s) { return '<li><span class="by by-' + s[1] + '">' + esc(T.BY[s[1]]) + '<span class="tm">' + esc(T.ago(s[0] - elapsed())) + '</span></span><span>' + hl(s[2]) + '</span></li>'; }).join('') + '</ol>';
  }
  function vDeal(key) {
    var d = T.deal(key), m = T.moduleOf(d.module), p = person(d), w = stateWord(d), inQ = S.queue.indexOf(key) >= 0;
    var band = '';
    if (d.decided) band = '<div class="needband"><b>' + esc(d.decided) + ' · sample data, nothing is paid</b></div>';
    else if (d.need && inQ && d.need.kind === 'watch') band = '<div class="needband watch"><p class="kicker" style="margin:0 0 .4rem">' + hl(d.need.headline) + '</p><p class="does" style="margin:0 0 .6rem">' + hl(d.need.does) + '</p>' + silenceHtml(d) + '</div>';
    else if (d.need && inQ) band = '<div class="needband"><b>Needs you · ' + hl(d.need.headline) + '</b>' + silenceHtml(d) + '<button class="btn gold" data-act="press:' + key + '">' + MINISEAL + ' Review &amp; decide</button></div>';
    else if (open(d)) band = '<div class="needband watch">' + silenceHtml(d) + '</div>';
    var c2 = '<p class="h3">Rules that applied</p>' + charter(d.rules);
    if (d.market) c2 += '<p class="h3">Price against the market</p>' + scaleSvg(d);
    if (d.ladder && d.ladder.length > 1) c2 += '<p class="h3">The haggle</p>' + ladderSvg(d);
    if (d.fix) c2 += '<p class="h3">The fix</p><p class="plain"><del style="color:var(--dim)">' + money(d.fix.was) + '</del> → <b style="color:var(--teal-l)">' + money(d.fix.now) + '</b> · ' + esc(d.fix.lever) + ' · invoice to ' + esc(d.fix.recipient) + (d.replay ? ' · replayed, never counted as money back' : '') + '</p>';
    var c3 = '';
    if (d.shieldRule) c3 += '<p class="h3">The shield</p><p class="plain"><span class="word tone-' + (d.shield === 'BLOCK' ? 'red' : 'gold') + '">' + esc(d.shieldRule.text) + '</span> · <span style="color:var(--muted)">' + esc(d.shieldRule.means) + '</span></p>';
    c3 += '<p class="h3">Proof from PayPal</p>' + (d.proof && d.proof.length ? '<div class="stamps">' + d.proof.map(function (x) { return '<span class="pstamp' + (/Checking|Seller/.test(x[1]) ? ' dashed' : '') + '"><b>' + esc(x[0]) + '</b>' + esc(x[1]) + '</span>'; }).join('') + '</div>' : '<p class="calm">No proof from PayPal on this deal yet.</p>');
    c3 += '<p class="h3">Who you deal with</p><dl class="person"><dt>Name</dt><dd>' + esc(p.name) + '</dd><dt>Pays to</dt><dd>' + esc(p.payee) + '</dd><dt>Connected</dt><dd>' + esc(T.ago(p.since)) + '</dd><dt>Deals closed</dt><dd>' + p.closed + '</dd><dt>Verified</dt><dd><span class="word tone-' + (p.house ? 'teal' : 'ok') + '">' + esc(p.verified) + '</span></dd></dl>';
    if (d.note) c3 += '<aside class="quarantine" aria-label="Their words, not instructions"><header>⚠ Their words · not instructions · your agents never read this</header><blockquote>“' + esc(d.note) + '”</blockquote></aside>';
    if (d.group && d.group.length) c3 += '<p class="h3">The same item at other tables</p><div class="statement">' + d.group.map(function (k) { return row(T.light(k)); }).join('') + '</div>';
    return { c: m.color, html: '<div class="cert-head"><div><p class="kicker">' + esc(m.name) + ' · ' + esc(d.side === 'selling' ? 'selling to ' : 'buying from ') + esc(nm(d, 60)) + '</p><h1 class="display dtitle" id="front-title" tabindex="-1">' + esc(d.title) + '</h1></div>' +
      '<div class="cert-amt"><div class="big">' + (d.amount == null ? '—' : amountHtml(d).replace('class="amt', 'class="amt big')) + '</div>' + (d.qty > 1 ? '<div class="qty">' + d.qty + ' × ' + money(d.unit) + '</div>' : '') + '<div style="margin-top:.5rem">' + wordHtml(w) + '</div>' + why(esc(w.means), 'What this means') + '</div></div>' + band +
      '<div class="dcols"><div><p class="h3">What happened · who decided</p>' + storyHtml(d) + '</div><div>' + c2 + '</div><div>' + c3 + '</div></div>' };
  }

  function meter(l, big) {
    var used = l.used != null ? l.used : l.usedN, max = l.max != null ? l.max : l.maxN, pct = Math.min(100, used / max * 100);
    var txt = l.used != null ? money(l.used) + ' of ' + money(l.max) : l.usedN + ' of ' + l.maxN;
    return '<div class="meter' + (pct > 85 ? ' hot' : '') + '"><div class="row"><b style="font-weight:500' + (big ? ';font-size:1.2rem' : '') + '">' + esc(big ? l.name : l.short) + '</b><span>' + txt + '</span></div><div class="bar"><i style="width:' + pct.toFixed(1) + '%"></i></div></div>';
  }
  function vRules() {
    var r = T.RULES.filter(function (x) { return x.key === S.rule; })[0] || T.RULES[0], live = T.RULES.filter(function (x) { return !x.retired; }).length;
    var listH = T.RULES.map(function (x) {
      return '<button class="rpick" style="--c:' + modColor(x.color) + '" data-act="rule:' + x.key + '" aria-pressed="' + (x === r) + '"><span class="dot"></span><span><b>' + esc(x.name) + '</b><small>' + esc(x.agent) + ' · ' + esc(x.summary) + '</small></span>' +
        (x.retired ? '<span class="word line tone-line">retired</span>' : '<span class="word tone-ok">in force</span>') + '</button>';
    }).join('');
    var doc = r ? '<article class="rdoc" style="--c:' + modColor(r.color) + '"><p class="kicker">' + esc(r.agent) + ' · version ' + r.version + ' · signed ' + esc(T.ago(r.signed)) + '</p><h2 class="rdt">' + esc(r.name) + '</h2>' +
      '<p class="sub">' + (r.retired ? 'Retired by you. Deals made under it stay in the record; it allows nothing new.' : 'In force · ' + esc(T.timeLeft(r.left)) + ' left · ' + T.count(r.lines.length, 'line') + ', signed by you') + '</p><ul class="rlines">' +
      r.lines.map(function (l) { return '<li><span>' + esc(l[0]) + '</span><span>' + hl(l[2] && l[2].length > 4 ? 'only ' + l[2].slice(0, 4).join(', ') + ' and ' + (l[2].length - 4) + ' more' : l[2] ? 'only ' + l[2].join(', ') : l[1]) + (l[2] && l[2].length > 4 ? '<details class="more"><summary>All ' + l[2].length + '</summary>' + esc(l[2].join(', ')) + '</details>' : '') + '</span></li>'; }).join('') + '</ul></article>' : '';
    return { c: 'var(--gold)', html: '<div class="lhead"><div><p class="kicker">Rules · signed by you</p><h1 class="display" id="front-title" tabindex="-1">Your agents act only inside the ' + T.count(live, 'set') + ' of rules you signed.</h1></div>' +
      '<div class="limbox"><p class="h3">Wallet limits · today</p>' + T.LIMITS.map(function (l) { return meter(l); }).join('') + '<button class="linkish" data-go="rules/limits">One cap above all rules ›</button></div></div>' +
      '<div class="rgrid"><div class="rlist">' + listH + '</div>' + doc + '</div>' };
  }
  function vLimits() {
    var parts = T.LIMITS_ABOUT.split('. ');
    return { c: 'var(--gold)', fit: true, html: '<p class="kicker">Rules · Wallet limits</p><h1 class="display" id="front-title" tabindex="-1">' + esc(parts[0]) + '.</h1><p class="sub" style="max-width:52rem">' + esc(parts.slice(1).join('. ')) + '</p>' +
      '<div class="limgrid">' + T.LIMITS.map(function (l) { return meter(l, true); }).join('') + '</div><p class="silence">' + HOURGLASS + '<span>' + esc(T.SAFETY_PROMISE) + '</span></p>' };
  }
  function vConnections() {
    var pend = T.PENDING.length ? '<div class="pending"><p class="h3">Waiting to connect · ' + T.PENDING.length + '</p>' + T.PENDING.map(function (p) {
      return '<div class="lrow"><span><b>' + esc(short(p.context, 90)) + '</b><small>four words to match · ' + (p.expires > 0 ? esc(T.timeLeft(p.expires)) + ' left' : 'expired') + ' · if you do nothing, nothing is connected</small></span><button class="btn gold sm" data-act="pair:' + p.i + '">' + MINISEAL + ' Check the four words</button></div>'; }).join('') + '</div>' : '';
    var st = L('people').sub ? 'subs' : 'trade';
    return { c: 'var(--teal)', html: '<div class="lhead"><div><p class="kicker">Connections</p><h1 class="display" id="front-title" tabindex="-1">PayPal is connected, in sandbox.</h1></div></div>' +
      '<div class="congrid"><div><p class="h3">This wallet</p><div class="list2">' + T.CONNECTIONS.map(function (c) { return '<div class="lrow"><span>' + esc(c.name) + '<small>' + esc(c.line) + '</small></span><span class="word tone-' + c.tone + '">' + esc(c.state) + '</span></div>'; }).join('') + '</div>' + pend + '</div>' +
      '<div><div class="seg" role="group" aria-label="Who"><button data-act="ppl:trade" aria-pressed="' + (st === 'trade') + '">Who you trade with <i>' + T.COUNTS.people + '</i></button><button data-act="ppl:subs" aria-pressed="' + (st === 'subs') + '">Subscribers <i>' + T.COUNTS.subs + '</i></button></div>' +
      listBlock(st === 'subs' ? 'people:subs' : 'people:trade', { noun: st === 'subs' ? 'subscribers' : 'people' }) + '</div></div>' };
  }
  function vSettings() {
    var rows = [
      ['Approving', S.locked ? 'Locked · unlock with your device to approve' : 'Unlocked · locks again after 15 quiet minutes', S.locked ? '<button class="btn sm" data-act="unlocknow">Unlock</button>' : '<button class="btn sm" data-act="lock">Lock now</button>'],
      ['Sample world', 'Which sample data this page shows: ' + T.SCALES[T.SCALE].label.toLowerCase() + ' (' + T.SCALES[T.SCALE].line + ')', '<button class="btn sm" data-scale="' + (T.SCALE === 'large' ? 'small' : 'large') + '">Show the ' + T.SCALES[T.SCALE === 'large' ? 'small' : 'large'].label.toLowerCase() + '</button>'],
      ['Your charter', 'PayPal keys, rules, practice deal, agent app, unlock', '<button class="btn sm" data-go="setup/again">See setup again</button>'],
      ['Calm motion', RM.matches ? 'Your computer asks for reduced motion, so the page stays still and only crossfades.' : 'Stops the seal turning and the sheets moving; pages only crossfade.', '<button class="btn sm" data-act="calm" aria-pressed="' + document.body.classList.contains('calm') + '">' + (calm() ? 'On' : 'Off') + '</button>'],
      ['Mode', 'Sandbox · all money here is PayPal test money · sample data, nothing is paid', '<span class="badge sandbox">Sandbox</span>'],
      ['First visit', 'Show the first-run setup again, as a new owner would see it', '<button class="btn sm quiet" data-act="firstrun">Show first run</button>']
    ];
    return { c: 'var(--steel)', fit: true, html: '<p class="kicker">Settings</p><h1 class="display" id="front-title" tabindex="-1">Your wallet, your controls.</h1><div class="list2 setlist">' +
      rows.map(function (r) { return '<div class="lrow"><span>' + esc(r[0]) + '<small>' + esc(r[1]) + '</small></span>' + r[2] + '</div>'; }).join('') + '</div>' };
  }
  function vRewind() {
    return { c: 'var(--teal-l)', html: '<div class="rwgrid"><div class="rwl"><p class="kicker">Rewind · ' + esc(T.AWAY.since) + '</p><h1 class="display" id="front-title" tabindex="-1">' + hl(T.AWAY.headline) + '. Waiting never sent money.</h1>' +
      '<ul class="away">' + T.AWAY.lines.map(function (l) { return '<li><span class="word tone-' + l.tone + (l.tone === 'dashed' ? ' dashed' : l.tone === 'line' ? ' line' : '') + '"></span> ' + hl(l.text) + '</li>'; }).join('') + '</ul>' +
      '<p class="calm">' + T.count(T.AWAY.steps, 'step') + ' in the last two days. Open any step to see its deal.</p></div>' +
      '<div class="rwr"><p class="h3">Every step, newest first</p>' + listBlock('rewind', { noun: 'steps', toolbar: true }) + '</div></div>' };
  }

  /* setup: the charter */
  var ROMAN = ['I', 'II', 'III', 'IV', 'V'];
  function suStep() { for (var i = 0; i < T.SETUP.length; i++) if (!S.su.done[T.SETUP[i].key]) return i; return T.SETUP.length; }
  function suValue(k) {
    if (k === 'keys') return 'PayPal keys saved <span class="fstamp">connected · sandbox</span>';
    if (k === 'rules') return T.STARTER_RULES.length + ' rules printed in <span class="fstamp">signed</span>';
    if (k === 'practice') return 'House seller · four words matched <span class="fstamp">connected</span>';
    if (k === 'agent') { var e = T.ENGINES.filter(function (x) { return x.id === S.su.engine; })[0]; return esc(e ? e.name : T.ENGINES[2].name) + ' <span class="fstamp">chosen</span>'; }
    return 'Device unlock <span class="fstamp">sealed</span>';
  }
  function vSetup(v) {
    var i = suStep(), st = T.SETUP[i];
    var fields = '<ol class="fields">' + T.SETUP.map(function (s, j) {
      var done = S.su.done[s.key];
      return '<li class="' + (done ? 'done' : j === i ? 'cur' : '') + '"><span class="num">' + ROMAN[j] + '</span><span><span class="lbl">' + esc(s.label) + (s.privileged ? ' · in Approvals' : '') + '</span><span class="ex">' + esc(s.text.split('. ')[0].replace(/\.$/, '')) + '.</span><span class="val">' + (done ? suValue(s.key) : '') + '</span></span></li>'; }).join('') + '</ol>';
    var left;
    if (!st) {
      left = '<p class="kicker">Your wallet’s charter · sealed</p><h1 class="display" id="front-title" tabindex="-1">Your charter is sealed. Nothing pays without you or a rule you signed.</h1>' +
        (v.layer ? '<div class="acts"><button class="btn steel" data-act="suagain">Walk through it again</button></div><p class="sub" style="margin-top:1rem">Your wallet stays ready while you look.</p>' : '');
    } else {
      left = '<p class="kicker">Your wallet’s charter · line ' + ROMAN[i] + ' of V</p><h1 class="display" id="front-title" tabindex="-1">' + esc(st.lead) + '.</h1><p class="sub">' + esc(st.text) + '</p>';
      if (st.privileged) left += '<div class="acts"><button class="btn gold big" data-act="supress:' + st.key + '">' + esc(st.act) + '</button><span class="priv">' + MINISEAL + ' opens Approvals</span></div>';
      else if (st.key === 'practice') {
        if (S.su.phase === 'code') left += '<p class="h3">Share this code with the house seller</p><div class="code">' + esc(T.PAIRING.code) + '</div><div class="acts"><button class="btn gold" data-act="spair:shared">I shared the code</button></div>';
        else if (S.su.phase === 'words') left += '<p class="h3">Do these four words match the house seller’s?</p><div class="words">' + T.PAIRING.words.map(function (w) { return '<span>' + esc(w) + '</span>'; }).join('') + '</div><div class="acts"><button class="btn gold" data-act="spair:match">All four match</button><button class="btn red" data-act="spair:differ">One differs, stop</button></div>';
        else left += '<p class="err">Stopped. Nothing was connected and nothing was offered.</p><div class="acts"><button class="btn steel" data-act="spair:again">Start again with a new code</button></div>';
      } else if (st.key === 'agent') {
        left += '<div class="engines">' + T.ENGINES.map(function (e) { return '<button class="engine" data-act="engine:' + e.id + '"><b>' + esc(e.name) + '</b><span>' + esc(e.text) + '</span></button>'; }).join('') + '</div>';
      }
    }
    if (st && (st.privileged || (st.key === 'practice' && S.su.phase === 'code')))
      left += '<div class="chpreview"><p class="h3">When you sign it, line ' + ROMAN[i] + ' reads</p><ol class="fields"><li class="done"><span class="num">' + ROMAN[i] + '</span><span><span class="lbl">' + esc(st.label) + '</span><span class="val">' + suValue(st.key) + '</span></span></li></ol></div>';
    if (!v.layer) left += '<p style="margin-top:1.6rem"><button class="skip" data-act="skip">Skip: open the sample wallet (already set up)</button></p>';
    var nDone = T.SETUP.filter(function (s) { return S.su.done[s.key]; }).length;
    left += '<div class="chnote"><p class="h3">What signing the charter means</p><ul class="away">' +
      '<li><span class="word tone-gold"></span> ' + nDone + ' of 5 lines signed. Each line takes a minute or two.</li>' +
      '<li><span class="word tone-teal"></span> Lines marked “in Approvals” open the separate approval window, where only you can sign.</li>' +
      '<li><span class="word tone-ok"></span> ' + esc(T.SAFETY_PROMISE) + '</li>' +
      '<li><span class="word tone-line line"></span> This is sample data on test money: nothing is paid.</li></ul></div>';
    return { c: 'var(--gold)', mode: 'setup', html: '<div class="chgrid"><div class="chl">' + left + '</div><div class="chr"><p class="h3">Your wallet’s charter</p>' + fields + '</div></div>' };
  }

  function render(v) {
    switch (v.name) {
      case 'centre': return vCentre();
      case 'module': return vModule(v.key);
      case 'deal': return vDeal(v.key);
      case 'ledger': return vLedger();
      case 'record': return vRecord();
      case 'ask': return vAsk();
      case 'rules': return vRules();
      case 'limits': return vLimits();
      case 'connections': return vConnections();
      case 'settings': return vSettings();
      case 'rewind': return vRewind();
      case 'setup': return vSetup(v);
      case 'waiting': return vWaiting();
    }
    return vCentre();
  }

  /* ---------------------------------------------------------------- chrome: crumbs, seal, stack */
  function presence() {
    if (S.flash) return S.flash;
    var v = S.view;
    if (v.name === 'setup' && !v.layer) return { s: 'quiet', w: 'Not sealed yet', d: 'Nothing can pay until your charter is signed' };
    if (!S.queue.length) return { s: 'quiet', w: 'Quiet', d: 'Nothing needs you · no money moves' };
    if (v.name !== 'centre') return { s: 'watching', w: 'Watching', d: S.queue.length + ' need you · waiting never pays' };
    var d = curDeal(), k = d.need.kind;
    if (k === 'payhold') return { s: 'holding', w: 'Holding ' + money(d.amount), d: 'On hold at PayPal · not paid' };
    if (k === 'shield') return { s: 'holding', w: 'Paused for you', d: 'Held before any PayPal call' };
    if (k === 'watch') return d.checking ? { s: 'watching', w: 'Checking with PayPal', d: 'Nothing more is sent' } : { s: 'stopped', w: 'Stopped', d: 'It will not be paid' };
    return { s: 'needs', w: 'A deal needs you', d: 'Nothing moves until you decide' };
  }
  function arc() {
    var el = $('#arcl'); if (!el) return;
    var d = S.view.name === 'centre' ? curDeal() : null, f = 0;
    if (d && d.deadline != null) { var left = d.deadline - elapsed(), total = d.deadline - (d.created || d.deadline - 86400); f = Math.max(0, Math.min(1, left / Math.max(1, total))); }
    el.style.strokeDasharray = f.toFixed(4) + ' 1';
    $('#seal').classList.toggle('timed', f > 0);
  }
  function chrome() {
    var v = S.view, ch = chain(v), lv = ch.length;
    document.body.classList.toggle('deep', lv > 1);
    var cr = '';
    ch.forEach(function (c, i) {
      cr += '<span class="sep" aria-hidden="true">›</span>';
      cr += i === ch.length - 1 ? '<span class="here" aria-current="page">' + esc(labelOf(c)) + '</span>' : '<button data-crumb="' + i + '">' + esc(labelOf(c)) + '</button>';
    });
    $('#crumbs').innerHTML = cr; S.crumbs = ch;
    var dp = ''; for (var i = 0; i < 4; i++) dp += '<i class="' + (i < lv ? 'on' : '') + '"></i>'; $('#depth').innerHTML = dp;
    var n = S.queue.length, pill = $('#needpill');
    pill.textContent = n ? n + ' need you' : 'Nothing needs you'; pill.classList.toggle('zero', !n);
    pill.setAttribute('aria-label', n ? n + ' decisions need you. Go to the decision centre.' : 'Nothing needs you. Go to the decision centre.');
    var place = ch.length > 1 ? ch[1].name : '';
    $$('.cbtn[data-place]').forEach(function (b) { b.classList.toggle('on', b.dataset.place === place || (b.dataset.place === 'rules' && place === 'limits')); });
    var mk = null; ch.forEach(function (c) { if (c.name === 'module') mk = c.key; if (c.name === 'deal' && !mk) mk = T.light(c.key).module; if ((c.name === 'ledger' || c.name === 'ask' || c.name === 'record') && !mk) mk = 'book'; });
    $$('#tabs .tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.key === mk);
      t.setAttribute('aria-current', t.dataset.key === mk ? 'page' : 'false');
      var c = S.queue.filter(function (k) { return T.light(k).module === t.dataset.key; }).length, el = $('.cnt', t);
      el.textContent = c ? n0(c) : ''; el.style.display = c ? '' : 'none';
    });
    var pn = v.name === 'centre' ? Math.min(3, Math.max(0, S.queue.length - 1)) : Math.min(3, lv - 1), ps = '';
    for (var j = 0; j < pn; j++) ps += '<div class="psheet' + (v.name === 'centre' ? ' gold' : '') + '" style="--k:' + (j + 1) + '"></div>';
    $('#pile').innerHTML = ps;
    var p = presence(), seal = $('#seal');
    if (seal.dataset.s !== p.s) seal.dataset.s = p.s;
    $('#sealw').textContent = p.w; $('#seald').textContent = p.d;
    $('#presence').innerHTML = '<b>' + esc(p.w) + '</b> · ' + esc(p.d);
    document.documentElement.style.setProperty('--seal', { quiet: 'var(--steel)', watching: 'var(--teal)', needs: 'var(--gold)', holding: 'var(--coral)', paid: 'var(--ok)', stopped: 'var(--red)' }[p.s]);
    var d = v.name === 'centre' ? curDeal() : null, disc = $('#seal .disc');
    if (d && d.need.kind !== 'watch') { disc.dataset.act = 'press:' + d.key; disc.title = 'Press the seal to review'; } else { delete disc.dataset.act; disc.removeAttribute('title'); }
    arc();
  }
  function buildTabs() {
    $('#tabs').innerHTML = T.MODULES.map(function (m, i) {
      return '<button class="tab" style="--c:' + m.color + ';--i:' + i + ';--tex:' + tex(m.color, .07) + '" data-key="' + m.key + '" data-go="m/' + m.key + '" aria-label="' + esc(m.name + ': ' + m.what + '. ' + m.answer) + '">' + glyph(m.key) + '<span class="tn">' + esc(m.name) + '</span><span class="tt">' + n0(m.total) + '</span><span class="cnt"></span></button>';
    }).join('');
    $$('#tabs .tab').forEach(function (tab) {
      var m = T.moduleOf(tab.dataset.key);
      var on = function () {
        if (NARROW.matches || tab.classList.contains('active') || S.press) return;
        var mq = $('#marquee'); mq.style.setProperty('--mc', m.color);
        mq.innerHTML = '<div class="mart" style="color:' + m.color + '">' + art(m.key) + '</div><div class="mtx"><div class="k">' + esc(m.what) + '</div><div class="n">' + esc(m.name) + '</div><div class="a">' + hl(m.answer) + '</div><div class="h">' + (m.total ? n0(m.total) + ' ' + (m.key === 'rescue' ? 'renewals' : 'deals') + (m.waiting ? ' · ' + m.waiting + ' wait for you' : '') + ' · ' : '') + 'Open this layer ›</div></div>';
        mq.classList.add('on'); $('#front').classList.add('dim');
      };
      var off = function () { $('#marquee').classList.remove('on'); $('#front').classList.remove('dim'); };
      tab.addEventListener('mouseenter', on); tab.addEventListener('focus', on);
      tab.addEventListener('mouseleave', off); tab.addEventListener('blur', off); tab.addEventListener('click', off);
    });
  }

  /* ---------------------------------------------------------------- paint + choreography */
  function paint() {
    chrome();
    var r = render(S.view), f = $('#front'), body = $('#frontbody');
    f.style.setProperty('--c', r.c);
    f.style.setProperty('--tex', tex(r.c, .05));
    f.className = 'sheet mode-' + (r.mode || 'deep');
    body.className = 'inner' + (S.view.name === 'centre' ? ' vc' : '');
    body.innerHTML = r.html;
    $('#pagers').innerHTML = r.after || '';
    $$('.stamp', f).forEach(function (s) { s.remove(); });
    $('#stage').classList.toggle('fit', !!r.fit && !NARROW.matches);
    $('#under').innerHTML = r.fit ? underHtml() : '';
    $$('[data-hold]', f).forEach(bindHold);
    $$('.lst', f).forEach(firstPeek);
    body.scrollTop = 0;
  }
  function underHtml() {
    var cur = S.view.name === 'module' ? S.view.key : null;
    return '<p class="h3">Further down the stack</p><div class="ustrips">' + (S.queue.length ? '<button class="ustrip gold" data-go="centre"><b>What needs you</b><span>' + S.queue.length + ' waiting · none moves money while it waits</span></button>' : '') +
      T.MODULES.filter(function (m) { return m.key !== cur; }).map(function (m) {
        return '<button class="ustrip" style="--c:' + m.color + '" data-go="m/' + m.key + '">' + glyph(m.key) + '<b>' + esc(m.name) + '</b><span>' + hl(m.answer) + '</span></button>';
      }).join('') + '</div>';
  }
  var anim = null, seq = 0;
  function kf(how) {
    if (calm()) return { out: [{ opacity: 1 }, { opacity: 0 }], inn: [{ opacity: 0 }, { opacity: 1 }], d1: 140, d2: 220 };
    var K = {
      into: { out: [{ transform: 'none', opacity: 1 }, { transform: 'translate3d(0,3rem,-320px) rotateX(7deg)', opacity: 0 }],
        inn: [{ transform: 'translate3d(0,-5rem,-240px) rotateX(-10deg)', opacity: 0 }, { transform: 'translate3d(0,-1.5rem,50px) rotateX(-3deg)', opacity: 1, offset: .55 }, { transform: 'none', opacity: 1 }] },
      out: { out: [{ transform: 'none', opacity: 1 }, { transform: 'translate3d(0,-5rem,-300px) rotateX(-10deg)', opacity: 0 }],
        inn: [{ transform: 'translate3d(0,2.5rem,-160px) rotateX(5deg)', opacity: 0 }, { transform: 'none', opacity: 1 }] },
      next: { out: [{ transform: 'none', opacity: 1 }, { transform: 'translate3d(-10rem,-1.2rem,60px) rotateZ(-4deg) rotateY(-10deg)', opacity: 1, offset: .35 }, { transform: 'translate3d(-70rem,-4rem,0) rotateZ(-12deg) rotateY(-24deg)', opacity: 0 }],
        inn: [{ transform: 'translate3d(0,1.2rem,-90px)', opacity: .35 }, { transform: 'none', opacity: 1 }] },
      prev: { out: [{ transform: 'none', opacity: 1 }, { transform: 'translate3d(0,1.4rem,-120px)', opacity: 0 }],
        inn: [{ transform: 'translate3d(-66rem,-4rem,0) rotateZ(-11deg) rotateY(-22deg)', opacity: 0 }, { transform: 'none', opacity: 1 }] },
      swap: { out: [{ transform: 'none', opacity: 1 }, { transform: 'translate3d(0,0,-140px)', opacity: 0 }],
        inn: [{ transform: 'translate3d(0,0,-140px)', opacity: 0 }, { transform: 'none', opacity: 1 }] }
    };
    var k = K[how] || K.swap; k.d1 = how === 'next' ? 380 : 260; k.d2 = how === 'into' ? 560 : 440; return k;
  }
  function go(view, how) {
    var from = S.view;
    if (!how) { var a = level(view), b = level(from); how = a > b ? 'into' : a < b ? 'out' : 'swap'; }
    S.view = view; var my = ++seq;
    hideMarquee();
    if (view.approve) { var qi = S.queue.indexOf(view.approve); if (qi >= 0) S.cur = qi; delete view.approve; }
    setHash();
    var f = $('#wrap');
    if (anim) { try { anim.cancel(); } catch (e) { /* ignore */ } anim = null; }
    if (!f.animate) { paint(); focusFront(); return; }
    var k = kf(how);
    var stepped = false;
    var a1 = anim = f.animate(k.out, { duration: k.d1, easing: 'cubic-bezier(.55,0,.7,.2)', fill: 'forwards' });
    var step = function () {
      if (stepped || my !== seq) return; stepped = true;
      paint();
      anim = f.animate(k.inn, { duration: k.d2, easing: 'cubic-bezier(.2,.8,.2,1)' });
      try { a1.cancel(); } catch (e) { /* ignore */ }
      var done = false, fin = function () { if (done) return; done = true; if (my === seq) { anim = null; focusFront(); } };
      anim.onfinish = fin; setTimeout(fin, k.d2 + 120);
    };
    a1.onfinish = step; setTimeout(step, k.d1 + 120);
  }
  function focusFront() { var t = $('#front-title'); if (t && !S.press && !$('#find').classList.contains('on')) { try { t.focus({ preventScroll: true }); } catch (e) { t.focus(); } } }
  function hideMarquee() { $('#marquee').classList.remove('on'); $('#front').classList.remove('dim'); }
  function back() { var p = parentOf(S.view); if (p) go(p, 'out'); }
  function goStr(s) {
    if (s === 'centre') { if (S.view.name !== 'centre') go(V('centre')); return; }
    var v = fromHash(s); if (v) go(v);
  }

  /* ---------------------------------------------------------------- hold to confirm: pressing the seal */
  function holdBtn(label, act, disabled) {
    return '<button class="hold" data-hold="' + act + '"' + (disabled ? ' disabled' : '') + '><span class="ros">' + ROSETTE + '</span><span class="hl"><b>' + label + '</b><small>Press and hold · or hold Space</small></span></button>';
  }
  function bindHold(b) {
    var p = 0, raf = 0, t0 = 0, holding = false, done = false, rings = $$('.ros path', b);
    function set(v) { p = v; b.style.setProperty('--p', v.toFixed(3)); rings.forEach(function (r, i) { var s = Math.min(1, Math.max(0, v * rings.length - i)); r.style.strokeDashoffset = String(1 - s); }); }
    function tick() {
      if (!holding) return;
      var v = (performance.now() - t0) / HOLD_MS;
      if (v >= 1) { set(1); holding = false; done = true; b.classList.remove('holding'); b.classList.add('sealed'); setTimeout(function () { act(b.dataset.hold, b); }, calm() ? 80 : 460); return; }
      set(v); raf = requestAnimationFrame(tick);
    }
    function start() { if (b.disabled || done || holding) return; holding = true; t0 = performance.now() - p * HOLD_MS; b.classList.add('holding'); raf = requestAnimationFrame(tick); }
    function stop() {
      if (!holding) return; holding = false; cancelAnimationFrame(raf); b.classList.remove('holding');
      var from = p, ts = performance.now();
      (function backoff() { if (holding || done) return; var v = from - (performance.now() - ts) / 280; set(Math.max(0, v)); if (v > 0) requestAnimationFrame(backoff); })();
    }
    b.addEventListener('pointerdown', function (e) { if (e.button !== 0) return; e.preventDefault(); b.focus(); start(); });
    b.addEventListener('pointerleave', stop);
    b.addEventListener('pointerup', stop); b.addEventListener('pointercancel', stop);
    b.addEventListener('keydown', function (e) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) start(); } });
    b.addEventListener('keyup', function (e) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); stop(); } });
    b.addEventListener('blur', stop);
    b.addEventListener('click', function (e) { e.preventDefault(); });
    b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  /* ---------------------------------------------------------------- the approval layer */
  function openPress(p) {
    S.press = p; S.pressFrom = document.activeElement; S.adjust = false;
    hideMarquee(); renderPress();
    document.body.classList.add('pressing');
    ['stage', 'bar', 'foot'].forEach(function (id) { $('#' + id).inert = true; });
    setHash(); chrome();
    setTimeout(function () { var el = $('#press [data-hold]:not([disabled])') || $('#press input') || $('#pfoot .btn'); if (el) el.focus(); }, calm() ? 30 : 380);
  }
  function closePress(silent) {
    if (!S.press) return;
    S.press = null; document.body.classList.remove('pressing');
    ['stage', 'bar', 'foot'].forEach(function (id) { $('#' + id).inert = false; });
    setHash();
    if (!silent && S.pressFrom && document.contains(S.pressFrom)) S.pressFrom.focus();
  }
  function rangeRule(d) { return d.rules.filter(function (r) { return r.name === 'Price range'; })[0]; }
  function renderPress() {
    var P = S.press; if (!P) return;
    $('#lockchip').innerHTML = S.locked ? '● Locked' : '● Unlocked'; $('#lockchip').classList.toggle('locked', S.locked);
    $('#lockbtn').textContent = S.locked ? 'Locked' : 'Lock'; $('#lockbtn').disabled = S.locked;
    var body = '', foot = '', honest = '<span class="honest">Simulated · Sample data · nothing is paid</span>';
    if ((P.mode === 'deal' || P.mode === 'pair') && S.locked) {
      body = '<p class="kicker">Approving is locked</p><p class="display" style="font-size:2.4rem">Unlock with your device to approve.</p><p class="does">Nothing can be approved while it is locked. If you do nothing, no money moves.</p>';
      foot = '<button class="btn gold" data-act="hello">Unlock with your device</button>' + honest;
    } else if (P.mode === 'pair') {
      var pp = T.PENDING[P.i];
      body = '<div class="pgrid"><div><p class="kicker">Connections · a new wallet asks to connect</p><p class="display" style="font-size:2.3rem">Do these four words match the ones on the other side?</p><p class="who" style="overflow-wrap:anywhere">' + esc(pp.context) + '</p></div><div><div class="words">' + pp.words.map(function (w) { return '<span>' + esc(w) + '</span>'; }).join('') + '</div>' +
        '<p class="silence">' + HOURGLASS + '<span>If you do nothing: <b>nothing is connected and nothing is offered</b></span></p><p class="does">Only a wallet you connect can offer you anything. Your agents still act only inside your rules.</p></div></div>';
      foot = holdBtn('Hold to connect', 'paired:' + P.i) + '<button class="btn red" data-act="pairstop:' + P.i + '">One differs, stop</button>' + honest;
    } else if (P.mode === 'deal') {
      var d = T.deal(P.key), n = d.need, m = T.moduleOf(d.module), p = person(d);
      var head = '<p class="kicker">Review · ' + esc(m.name) + ' · ' + esc(n.headline.replace(/\s*\$[\d,.]+$/, '')) + '</p>';
      var left = '', rightc = '<p class="h3">Rules that applied</p>' + charter(d.rules);
      if (n.kind === 'approve') {
        left = head + '<div class="pamt">' + money(d.amount) + '</div><p class="who">to ' + esc(p.name) + ' · for ' + esc(d.title) + '</p>' + (d.market ? '<p class="h3">Price against the market</p>' + scaleSvg(d) : '') + (d.ladder && d.ladder.length > 1 ? '<p class="h3">The haggle</p>' + ladderSvg(d) : '') +
          '<p style="margin-top:1rem">Shield · ' + wordHtml({ text: T.SHIELD[d.shield || 'CLEAR'].text, tone: T.SHIELD[d.shield || 'CLEAR'].tone }) + '</p>';
        rightc += '<p class="h3">What approving does</p><p class="does">' + hl(n.does) + '</p>' + silenceHtml(d);
        if (S.adjust && d.range && d.range.most) {
          var most = d.range.most, rr = rangeRule(d), lo = Math.floor(most * .8 / 100) * 100;
          rightc += '<div class="adjust"><p class="kicker" style="margin:0">Adjust price range · most you’ll pay</p><div class="most" id="mostv">' + money(most) + '</div>' +
            '<input type="range" id="mostr" min="' + lo + '" max="' + most + '" step="' + Math.max(1, Math.round(most / 200)) + '" value="' + most + '" aria-label="Most you’ll pay" aria-valuetext="' + money(most) + '">' +
            '<div style="display:flex;justify-content:space-between;color:var(--dim);font-size:.92rem"><span>' + money(lo) + '</span><span>' + money(most) + '</span></div>' +
            '<p class="does" id="mostnote">You can only lower it here. A new range needs your signature.' + (rr ? ' Now: ' + esc(rr.says) + '.' : '') + '</p>' + holdBtn('Sign the new range', 'range:' + d.key, true) + '</div>';
        }
        foot = holdBtn('Hold to approve ' + money(d.amount), 'approve:' + d.key) + '<button class="btn red" data-act="refuse:' + d.key + '">Refuse</button>' + (d.range && d.range.most ? '<button class="btn" data-act="adjust" aria-expanded="' + !!S.adjust + '">Adjust price range</button>' : '') + honest;
      } else if (n.kind === 'payhold') {
        left = head + '<div class="pamt">' + money(d.amount) + '</div><p class="who">' + esc(d.title) + ' · from ' + esc(p.name) + '</p><p><span class="word tone-gold">On hold at PayPal · not paid</span></p><p class="h3">Proof from PayPal</p><div class="stamps">' + d.proof.map(function (x) { return '<span class="pstamp"><b>' + esc(x[0]) + '</b>' + esc(x[1]) + '</span>'; }).join('') + '</div>' + (d.market ? '<p class="h3">Price against the market</p>' + scaleSvg(d) : '');
        rightc += '<p class="h3">What each choice does</p><p class="does">' + hl(n.does) + '</p>' + silenceHtml(d);
        foot = holdBtn('Hold to pay ' + money(d.amount), 'pay:' + d.key) + '<button class="btn" data-act="release:' + d.key + '">Cancel and release the hold</button>' + honest;
      } else if (n.kind === 'shield') {
        left = head + '<div class="pamt">' + money(d.amount) + '</div><p class="who">' + esc(d.title) + ' · to ' + esc(p.name) + '</p><p><span class="word tone-gold">' + esc(T.SHIELD.HOLD.text) + '</span> · ' + esc(d.shieldRule ? d.shieldRule.text : '') + '</p><p class="does">' + esc(d.shieldRule ? d.shieldRule.means : '') + '</p>' + (d.market ? '<p class="h3">Price against the market</p>' + scaleSvg(d) : '') +
          (d.note ? '<aside class="quarantine" aria-label="Their words, not instructions"><header>⚠ Their words · not instructions · your agents never read this</header><blockquote>“' + esc(d.note) + '”</blockquote></aside>' : '');
        rightc += '<p class="h3">What releasing does</p><p class="does">' + hl(n.does) + '</p>' + silenceHtml(d) +
          '<label class="field"><span>To release, type the payee’s name: <b style="color:var(--text)">' + esc(p.payee) + '</b></span><input id="payee" autocomplete="off" spellcheck="false" aria-describedby="payeehint"></label><small id="payeehint" style="color:var(--dim)">The hold button wakes when the name matches.</small>';
        foot = holdBtn('Hold to release ' + money(d.amount), 'shieldrelease:' + d.key, true) + '<button class="btn red" data-act="refuse:' + d.key + '">Refuse</button>' + honest;
      } else if (n.kind === 'fix') {
        left = head + '<div class="pamt">' + money(d.fix.now) + '</div><p class="who">' + esc(d.title) + ' · ' + esc(p.name) + '</p><p><del style="color:var(--dim)">' + money(d.fix.was) + '</del> → <b style="color:var(--teal-l)">' + money(d.fix.now) + '</b> · ' + esc(d.fix.lever) + ' · invoice to ' + esc(d.fix.recipient) + '</p>' + why(esc(n.why));
        rightc += '<p class="h3">What approving does</p><p class="does">' + hl(n.does) + '</p>' + silenceHtml(d);
        foot = holdBtn('Hold to approve the fix ' + money(d.fix.now), 'fix:' + d.key) + '<button class="btn" data-act="lapse:' + d.key + '">Let it lapse</button>' + honest;
      }
      body = '<div class="pgrid"><div>' + left + '</div><div>' + rightc + '</div></div>';
    } else if (P.mode === 'keys') {
      var st = T.SETUP[0];
      body = '<div class="pgrid"><div><p class="kicker">Charter · line I · PayPal keys</p><p class="display" style="font-size:2.4rem">' + esc(st.lead) + '.</p><p class="does">' + esc(st.text) + '</p></div><div>' +
        '<label class="field"><span>Client id (sandbox)</span><input type="password" id="k1" value="sample-sandbox-client-0000" autocomplete="off"></label>' +
        '<label class="field"><span>Secret (sandbox)</span><input type="password" id="k2" value="sample-sandbox-secret-0000" autocomplete="off"></label>' +
        '<p class="does">Saved securely on this computer and never shown again.</p></div></div>';
      foot = '<button class="btn gold" data-act="savekeys">Save PayPal keys</button>' + honest;
    } else if (P.mode === 'rules') {
      body = '<div class="pgrid"><div><p class="kicker">Charter · line II · your rules</p><p class="display" style="font-size:2.4rem">' + esc(T.SETUP[1].lead) + '.</p><p class="does">' + esc(T.SETUP[1].text) + '</p></div><div><p class="h3">The starter set</p><ul class="charter">' +
        T.STARTER_RULES.map(function (r) { return '<li><span class="mark tone-teal" aria-hidden="true">✓</span><span><span class="nm">' + esc(r[0]) + '</span><span class="says">' + hl(r[1]) + '</span></span><span></span></li>'; }).join('') + '</ul></div></div>';
      foot = holdBtn('Hold to sign these rules', 'signrules') + honest;
    } else if (P.mode === 'unlock') {
      body = '<p class="kicker">Charter · line V · unlock</p><p class="display" style="font-size:2.4rem">' + esc(T.SETUP[4].lead) + '. Press the seal for the first time.</p><p class="does">' + esc(T.SETUP[4].text) + '</p>';
      foot = holdBtn(esc(T.SETUP[4].act), 'unlock') + honest;
    }
    $('#pbody').innerHTML = body; $('#pfoot').innerHTML = foot;
    $$('#press [data-hold]').forEach(bindHold);
    var r = $('#mostr');
    if (r) r.addEventListener('input', function () {
      var d = T.deal(S.press.key), v = +r.value;
      $('#mostv').textContent = money(v); r.setAttribute('aria-valuetext', money(v));
      $('#press [data-hold^="range:"]').disabled = v === d.range.most;
      $('#mostnote').textContent = v < d.amount ? 'Lower than this offer: ' + money(d.amount) + ' would no longer fit your range.' : 'You can only lower it here. A new range needs your signature.';
    });
    var py = $('#payee');
    if (py) py.addEventListener('input', function () {
      var d = T.deal(S.press.key), ok = py.value.trim().toLowerCase() === String(person(d).payee).toLowerCase();
      $('#press [data-hold^="shieldrelease:"]').disabled = !ok; $('#payeehint').textContent = ok ? 'The name matches. Hold to release.' : 'The hold button wakes when the name matches.';
    });
  }

  /* ---------------------------------------------------------------- decisions (simulated) */
  var RESULT = {
    approve: { stamp: 'Approved', tone: 'teal', bucket: 'progress', sc: 'var(--gold)', story: function (d) { return 'You approved ' + money(d.amount); }, flash: { s: 'watching', w: 'Approved', d: 'Next: the PayPal payment request · nothing is paid' } },
    pay: { stamp: 'Paid', tone: 'ok', bucket: 'paid', sc: 'var(--ok)', story: function (d) { return 'You paid the hold, ' + money(d.amount); }, flash: { s: 'paid', w: 'Paid', d: 'Sample data · nothing is paid' } },
    release: { stamp: 'Hold released', tone: 'line', bucket: 'closed', sc: 'var(--steel)', story: function () { return 'You released the hold. Nothing was paid.'; }, flash: { s: 'quiet', w: 'Released', d: 'Nothing was paid' } },
    refuse: { stamp: 'Refused', tone: 'red', bucket: 'stopped', sc: 'var(--red)', story: function () { return 'You refused. No money moved.'; }, flash: { s: 'stopped', w: 'Refused', d: 'No money moved' } },
    shieldrelease: { stamp: 'Released', tone: 'teal', bucket: 'progress', sc: 'var(--teal)', story: function () { return 'You released the paused payment by typing the payee’s name'; }, flash: { s: 'watching', w: 'Released', d: 'It goes on inside your rules' } },
    fix: { stamp: 'Fix approved', tone: 'gold', bucket: 'progress', sc: 'var(--gold)', story: function (d) { return 'You approved one fix: ' + money(d.fix.now) + ' this cycle. PayPal sends the invoice.'; }, flash: { s: 'watching', w: 'Invoice sent', d: 'They pay on PayPal’s page, or it expires' } },
    lapse: { stamp: 'Let it lapse', tone: 'line', bucket: 'closed', sc: 'var(--steel)', story: function () { return 'You let it lapse. Nothing is sent.'; }, flash: { s: 'quiet', w: 'Nothing sent', d: 'PayPal retries the payment by itself' } }
  };
  function flash(f, ms) { S.flash = f; chrome(); clearTimeout(S.ft); S.ft = setTimeout(function () { S.flash = null; chrome(); }, ms || 3400); }
  function stampFront(main, color) {
    var s = document.createElement('div'); s.className = 'stamp'; s.style.setProperty('--sc', color || 'var(--gold)');
    s.innerHTML = esc(main) + '<small>sample data, nothing is paid</small>'; $('#front').appendChild(s);
  }
  function decide(kind, key) {
    var d = T.deal(key), r = RESULT[kind];
    if (kind === 'shieldrelease' || kind === 'refuse') d.shield = d.shield === 'HOLD' ? null : d.shield;
    d.story.push([elapsed(), 'you', r.story(d)]);
    d.decided = r.stamp; d.decidedTone = r.tone; d.decidedBucket = r.bucket; d.need = d.need && null;
    var qi = S.queue.indexOf(key); if (qi >= 0) { S.queue.splice(qi, 1); if (S.cur >= S.queue.length) S.cur = 0; }
    closePress(true);
    flash(r.flash);
    stampFront(r.stamp, r.sc);
    toast(r.stamp + ' · ' + short(d.title, 48));
    setTimeout(function () { if (S.view.name === 'centre') go(V('centre'), 'next'); else paint(); }, calm() ? 900 : 1300);
  }

  /* ---------------------------------------------------------------- actions */
  function toast(msg, plain) {
    var t = document.createElement('div'); t.className = 'toast';
    t.innerHTML = '<span>' + esc(msg) + '</span>' + (plain ? '' : '<small>Sample data · nothing is paid</small>');
    $('#toasts').appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 450); }, 3600);
  }
  function setupAdvance() {
    if (suStep() >= T.SETUP.length) { finishSetup(); return; }
    paint(); focusFront();
  }
  function finishSetup() {
    var layer = S.view.layer;
    store('tc3-ready', '1');
    paint();
    stampFront('Sealed', 'var(--gold)');
    flash({ s: 'needs', w: 'Sealed', d: 'Your charter is signed' }, 2600);
    setTimeout(function () { go(layer ? V('settings') : V('centre'), 'out'); }, calm() ? 700 : 1500);
  }
  function act(a, el) {
    var p = a.split(':'), k = p[0], arg = p[1];
    switch (k) {
      case 'back': back(); break;
      case 'find': openFind(); break;
      case 'next': if (S.queue.length > 1) { S.cur = (S.cur + 1) % S.queue.length; go(V('centre'), 'next'); } break;
      case 'prev': if (S.queue.length > 1) { S.cur = (S.cur - 1 + S.queue.length) % S.queue.length; go(V('centre'), 'prev'); } break;
      case 'pick': S.cur = +arg; go(V('centre'), S.view.name === 'centre' ? 'next' : 'out'); break;
      case 'later':
        if (S.queue.length < 2) { toast('Nothing else is waiting · nothing moves while it waits', true); break; }
        S.queue.push(S.queue.splice(S.cur, 1)[0]); if (S.cur >= S.queue.length - 1) S.cur = 0;
        toast('Moved to the back of the stack · nothing moves while it waits', true); go(V('centre'), 'next'); break;
      case 'seen': {
        var key = S.queue[S.cur]; S.queue.splice(S.cur, 1); if (S.cur >= S.queue.length) S.cur = 0;
        toast('Put away · ' + short(T.light(key).title, 48) + ' · nothing changed', true); go(V('centre'), 'next'); break;
      }
      case 'press': openPress({ mode: 'deal', key: arg }); break;
      case 'closepress': closePress(); break;
      case 'adjust': S.adjust = !S.adjust; renderPress(); var r = $('#mostr'); if (r) r.focus(); break;
      case 'lock': S.locked = true; toast('Approving is locked · simulated', true); if (S.press) renderPress(); if (S.view.name === 'settings') paint(); break;
      case 'unlocknow': openPress({ mode: 'deal', key: S.queue.filter(function (q) { return T.light(q).need.kind !== 'watch'; })[0] || S.queue[0] }); break;
      case 'hello':
        el.disabled = true; el.textContent = 'Waiting for your device…';
        setTimeout(function () { S.locked = false; toast('Unlocked with your device · simulated', true); if (S.press) renderPress(); var f = $('#press [data-hold]'); if (f) f.focus(); if (S.view.name === 'settings') paint(); }, 900); break;
      case 'approve': case 'pay': case 'release': case 'refuse': case 'shieldrelease': case 'fix': case 'lapse': decide(k, arg); break;
      case 'range': {
        var d = T.deal(arg), v = +$('#mostr').value; d.range.most = v;
        var rr = rangeRule(d); if (rr) { rr.says = 'most you’ll pay ' + money(v) + ' · ' + d.range.rounds + ' offers'; if (d.unit > v) { rr.result = 'stop'; rr.why = money(d.unit) + ' is above the new range'; } }
        S.adjust = false; renderPress(); toast('New price range signed · most you’ll pay ' + money(v)); break;
      }
      case 'ledgerf': S.ledgerKeys = null; L('ledger').f = arg; L('ledger').n = 0; go(V('ledger')); break;
      case 'ledgerall': S.ledgerKeys = null; paint(); focusFront(); break;
      case 'askall': { var qa = T.ASK[S.ask]; S.ledgerKeys = { keys: qa.keys, label: qa.q }; var st0 = L('ledger'); st0.f = 'all'; st0.q = ''; st0.n = 0; st0.mod = 'all'; go(V('ledger')); break; }
      case 'mfilter': { var sl = L('m:' + arg); sl.f = p[2]; sl.n = 0; refreshList('m:' + arg); var box = $('#lst-m_' + arg); if (box) box.scrollIntoView({ block: 'nearest', behavior: calm() ? 'auto' : 'smooth' }); break; }
      case 'ask': S.ask = +arg; paint(); var q = $$('.askq')[S.ask]; if (q) q.focus(); break;
      case 'rule': S.rule = arg; paint(); var rb = $('[data-act="rule:' + arg + '"]'); if (rb) rb.focus(); break;
      case 'ppl': L('people').sub = arg === 'subs'; paint(); var pb = $('[data-act="ppl:' + arg + '"]'); if (pb) pb.focus(); break;
      case 'pair': openPress({ mode: 'pair', i: +arg }); break;
      case 'paired': T.PENDING.splice(+arg, 1); T.PENDING.forEach(function (x, i) { x.i = i; }); closePress(true); toast('Connected · four words matched'); paint(); break;
      case 'pairstop': T.PENDING.splice(+arg, 1); T.PENDING.forEach(function (x, i) { x.i = i; }); closePress(true); toast('Stopped · nothing was connected', true); paint(); break;
      case 'calm': document.body.classList.toggle('calm'); paint(); var c = $('[data-act="calm"]'); if (c) c.focus(); break;
      case 'firstrun': store('tc3-ready', null); S.su = { done: {}, phase: 'code', engine: null }; go(V('setup'), 'out'); break;
      case 'skip': store('tc3-ready', '1'); T.SETUP.forEach(function (s) { S.su.done[s.key] = true; }); S.su.engine = 'practice'; toast('The sample wallet is open · already set up', true); go(V('centre'), 'out'); break;
      case 'suagain': S.su = { done: {}, phase: 'code', engine: null }; paint(); focusFront(); break;
      case 'supress': openPress({ mode: arg }); break;
      case 'savekeys': S.su.done.keys = true; closePress(true); toast('PayPal sandbox keys saved · never shown again'); setupAdvance(); break;
      case 'signrules': S.su.done.rules = true; closePress(true); toast('Rules signed · your agents act only inside them'); setupAdvance(); break;
      case 'unlock': S.su.done.unlock = true; S.locked = false; closePress(true); toast('Unlocked with your device · simulated'); setupAdvance(); break;
      case 'spair':
        if (arg === 'shared') S.su.phase = 'words';
        else if (arg === 'match') { S.su.done.practice = true; S.su.phase = 'code'; toast('House seller connected · its practice table is ready', true); setupAdvance(); break; }
        else if (arg === 'differ') S.su.phase = 'stopped';
        else S.su.phase = 'code';
        paint(); var g = $('#front .btn.gold, #front .btn.steel'); if (g) g.focus(); break;
      case 'engine': S.su.engine = arg; S.su.done.agent = true; toast('Agent app chosen', true); setupAdvance(); break;
    }
  }

  /* ---------------------------------------------------------------- find */
  var FIND = [], fsel = 0;
  function findItems() {
    var it = [];
    S.queue.forEach(function (k) { var d = T.light(k); it.push({ l: d.need.headline, s: 'Needs you · ' + nm(d, 30), g: 'approve/' + k }); });
    T.MODULES.forEach(function (m) { it.push({ l: m.name, s: m.what, g: 'm/' + m.key }); });
    [['Everything waiting', 'Needs you · the whole list', 'waiting'], ['Ledger', 'Book · every deal', 'book/ledger'], ['The record', 'Book · every step', 'book/record'], ['Ask your book', 'Book · questions', 'book/ask'], ['Rules', 'Signed by you', 'rules'], ['Wallet limits', 'Rules', 'rules/limits'], ['Connections', 'PayPal and people', 'connections'], ['Settings', 'Lock, setup, motion, sample world', 'settings'], ['Rewind', 'While you were away', 'rewind'], ['See setup again', 'Your charter', 'setup/again'], ['What needs you', 'The decision centre', 'centre']].forEach(function (x) { it.push({ l: x[0], s: x[1], g: x[2] }); });
    T.RULES.forEach(function (r) { it.push({ l: r.name, s: 'Rules · ' + r.agent, g: 'rule/' + r.key }); });
    T.DEALS.forEach(function (d) { it.push({ l: d.title, s: nm(d, 30) + ' · ' + stateWord(d).text, g: 'deal/' + d.key }); });
    return it;
  }
  function openFind() { if (S.press) return; FIND = findItems(); $('#find').classList.add('on'); $('#findq').value = ''; fsel = 0; renderFind(); $('#findq').focus(); }
  function closeFind() { $('#find').classList.remove('on'); focusFront(); }
  function filtered() { var q = $('#findq').value.trim().toLowerCase(); var out = []; for (var i = 0; i < FIND.length && out.length < 14; i++) { var x = FIND[i]; if (!q || (x.l + ' ' + x.s).toLowerCase().indexOf(q) >= 0) out.push(x); } return out; }
  function renderFind() {
    var f = filtered(); if (fsel >= f.length) fsel = Math.max(0, f.length - 1);
    $('#findl').innerHTML = f.length ? f.map(function (x, i) { return '<li role="option" aria-selected="' + (i === fsel) + '" class="' + (i === fsel ? 'sel' : '') + '" data-i="' + i + '"><b>' + esc(x.l) + '</b><span>' + esc(x.s) + '</span></li>'; }).join('') : '<li>Nothing found<span>try another word</span></li>';
    var sel = $('#findl .sel'); if (sel) sel.scrollIntoView({ block: 'nearest' });
  }
  function pickFind(i) {
    var x = filtered()[i]; if (!x) return;
    $('#find').classList.remove('on');
    if (x.g.indexOf('approve/') === 0) { var k = x.g.slice(8); S.cur = S.queue.indexOf(k); if (S.view.name === 'centre') { paint(); focusFront(); } else go(V('centre')); return; }
    if (x.g.indexOf('deal/') === 0) { go(V('deal', { key: x.g.slice(5), from: S.view.name === 'deal' ? parentOf(S.view) : S.view })); return; }
    if (x.g.indexOf('rule/') === 0) { S.rule = x.g.slice(5); if (S.view.name === 'rules') { paint(); focusFront(); } else go(V('rules')); return; }
    goStr(x.g);
  }
  $('#findq').addEventListener('input', function () { fsel = 0; renderFind(); });
  $('#findq').addEventListener('keydown', function (e) {
    var n = filtered().length;
    if (e.key === 'ArrowDown') { e.preventDefault(); fsel = Math.min(n - 1, fsel + 1); renderFind(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); fsel = Math.max(0, fsel - 1); renderFind(); }
    else if (e.key === 'Enter') { e.preventDefault(); pickFind(fsel); }
  });
  $('#findl').addEventListener('click', function (e) { var li = e.target.closest('li[data-i]'); if (li) pickFind(+li.dataset.i); });
  $('#find').addEventListener('click', function (e) { if (e.target.id === 'find') closeFind(); });

  /* ---------------------------------------------------------------- global input */
  function switchScale(s) { try { location.href = location.pathname + '?scale=' + s + '#centre'; } catch (e) { /* ignore */ } }
  document.addEventListener('click', function (e) {
    var sc = e.target.closest('[data-scale]'); if (sc) { if (sc.dataset.scale !== T.SCALE) switchScale(sc.dataset.scale); return; }
    var c = e.target.closest('[data-crumb]'); if (c) { go(S.crumbs[+c.dataset.crumb], 'out'); return; }
    var mo = e.target.closest('[data-more]'); if (mo) { var id = mo.dataset.more, st = L(id), cfg = listCfg(id); st.n = (st.n || cfg.page) + cfg.page; var box = mo.closest('.lst'), y = box ? $('.rowsw', box).children.length : 0; refreshList(id); void y; return; }
    var fb = e.target.closest('[data-f]'); if (fb) { var pf = fb.dataset.f.split(':'), fid = pf.slice(0, -1).join(':'); L(fid).f = pf[pf.length - 1]; L(fid).n = 0; refreshList(fid, fb); return; }
    var mb = e.target.closest('[data-mod]'); if (mb) { var pm = mb.dataset.mod.split(':'), mid = pm.slice(0, -1).join(':'); L(mid).mod = pm[pm.length - 1]; L(mid).n = 0; refreshList(mid, mb); return; }
    var g = e.target.closest('[data-go]');
    if (g) { e.preventDefault(); var s = g.dataset.go; if (s.indexOf('deal/') === 0) go(V('deal', { key: s.slice(5), from: S.view.name === 'deal' ? (S.view.from || null) : S.view })); else goStr(s); return; }
    var a = e.target.closest('[data-act]'); if (a) act(a.dataset.act, a);
  });
  document.addEventListener('input', function (e) {
    var t = e.target; if (!t.dataset || !t.dataset.q) return;
    var id = t.dataset.q; L(id).q = t.value; L(id).n = 0; clearTimeout(S.qt); S.qt = setTimeout(function () { refreshList(id); }, 120);
  });
  document.addEventListener('change', function (e) {
    var t = e.target; if (!t.dataset || !t.dataset.sort) return;
    var id = t.dataset.sort; L(id).sort = t.value; L(id).n = 0; refreshList(id);
  });
  function peekAt(e) {
    var r = e.target.closest && e.target.closest('[data-peek]'); if (!r) return;
    var box = r.closest('.lst'), pk = box && $('.peek', box); if (!pk || pk.dataset.k === r.dataset.peek) return;
    pk.dataset.k = r.dataset.peek; pk.innerHTML = peekHtml(T.deal(r.dataset.peek));
  }
  document.addEventListener('mouseover', peekAt); document.addEventListener('focusin', peekAt);
  function typing(t) { return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
  document.addEventListener('keydown', function (e) {
    endIntro();
    if (e.key === 'Escape') {
      e.preventDefault();
      if ($('#find').classList.contains('on')) closeFind();
      else if (S.press) closePress();
      else if ($('#marquee').classList.contains('on')) hideMarquee();
      else if (typing(e.target) && e.target.value) { e.target.value = ''; e.target.dispatchEvent(new Event('input', { bubbles: true })); }
      else back();
      return;
    }
    if (S.press) {
      if (e.key === 'Tab') { /* keep focus inside the approval layer */
        var f = $$('#press button:not([disabled]), #press input, #press summary'); if (!f.length) return;
        var i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
      return;
    }
    if (typing(e.target)) return;
    if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || e.key === '/') { e.preventDefault(); openFind(); return; }
    if ($('#find').classList.contains('on')) return;
    if (S.view.name === 'centre' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && e.target.type !== 'range') { e.preventDefault(); act(e.key === 'ArrowRight' ? 'next' : 'prev'); }
  });

  /* ---------------------------------------------------------------- live clocks */
  setInterval(function () { $$('[data-left]').forEach(function (el) { var d = T.light(el.dataset.left); if (d && d.deadline != null) el.textContent = leftOf(d); }); arc(); }, 1000);
  var rz = 0; window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { if (!S.press) paint(); }, 200); });

  /* ---------------------------------------------------------------- intro + boot */
  var introT = 0;
  function endIntro() { if (document.body.classList.contains('intro')) { document.body.classList.remove('intro'); clearTimeout(introT); } }
  document.addEventListener('pointerdown', endIntro, true);
  if (RM.addEventListener) RM.addEventListener('change', function () { paint(); });
  /* light and dark: the textures are drawn from the theme's tokens, so redraw them when it turns */
  document.addEventListener('themechange', function () { buildTabs(); $('#press .foil').style.setProperty('--gtex', tex('var(--on-gold)', .35, 'ruler')); if (!S.press) paint(); });

  buildSeal(); buildTabs();
  $('#press .foil').style.setProperty('--gtex', tex('var(--on-gold)', .35, 'ruler'));
  $('#promise').textContent = 'Waiting never pays · nothing moves without you';
  $$('.scaleswitch [data-scale]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.scale === T.SCALE)); });
  if (T.MISSING) toast('The sample data could not be read from ../data/scale/ · open this page from its folder', true);
  var ready = store('tc3-ready') === '1';
  var h = (location.hash || '').slice(1), start = h ? fromHash(h) : null;
  if (!start) start = ready ? V('centre') : V('setup');
  if (start.name === 'setup' && start.layer) T.SETUP.forEach(function (s) { S.su.done[s.key] = true; });
  if (ready && !(start.name === 'setup' && !start.layer)) { T.SETUP.forEach(function (s) { S.su.done[s.key] = true; }); S.su.engine = 'practice'; }
  if (start.name !== 'setup' && !ready) { store('tc3-ready', '1'); T.SETUP.forEach(function (s) { S.su.done[s.key] = true; }); }
  var approveKey = start.approve; delete start.approve;
  if (approveKey && S.queue.indexOf(approveKey) >= 0) S.cur = S.queue.indexOf(approveKey);
  S.view = start;
  if (!h && !RM.matches) { document.body.classList.add('intro'); introT = setTimeout(endIntro, 3000); }
  paint(); setHash();
  if (approveKey && T.light(approveKey) && T.light(approveKey).need && T.light(approveKey).need.kind !== 'watch') openPress({ mode: 'deal', key: approveKey });
  if (h.indexOf('lock') >= 0) { S.locked = true; if (S.press) renderPress(); }
  void document.body.offsetWidth;
  setTimeout(function () { document.body.classList.remove('booting'); }, 250);
  window.__tc3 = { S: S, go: go, V: V, openPress: openPress, act: act, paint: paint };
})();
