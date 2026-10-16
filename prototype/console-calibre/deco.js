/* The Table · Calibre: the instrument decoration module (stylised illustration, sample data).
   One motif for the whole brand: the calibrated scale. A hairline graticule, ticks at a fixed
   pitch, a reticle at the centre and one soft signal sweep. Everything here is drawn line-work;
   nothing is a screenshot. app.js asks this module for the dial, the textures and the key art,
   and falls back to its own engraving when this file is absent (the control). */
(function () {
  'use strict';
  var TAU = Math.PI * 2;
  var f1 = function (n) { return (Math.round(n * 100) / 100).toString(); };
  var pol = function (r, a) { return f1(r * Math.cos(a)) + ' ' + f1(r * Math.sin(a)); };
  /* n radial ticks between r0 and r1, one path */
  function ticks(r0, r1, n, off) {
    var d = '';
    for (var k = 0; k < n; k++) { var a = (k / n + (off || 0)) * TAU - Math.PI / 2; d += 'M' + pol(r0, a) + 'L' + pol(r1, a); }
    return d;
  }
  /* a ring broken into n dashes */
  function dashes(r, n, fill) {
    var d = '', w = TAU / n * (fill || .5);
    for (var k = 0; k < n; k++) { var a = k / n * TAU; d += 'M' + pol(r, a) + 'A' + r + ' ' + r + ' 0 0 1 ' + pol(r, a + w); }
    return d;
  }
  /* a token reference ("var(--gold)") resolved to the colour it holds now, for data-URI art */
  function resolve(c) {
    var m = /var\((--[\w-]+)\)/.exec(String(c));
    if (!m) return c;
    var v = getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim();
    return v ? resolve(v) : '#8796a7';
  }

  /* ------------------------------------------------ the dial: the wallet's presence */
  function seal(core, brand, minis) {
    var i = 0;
    function P(d) { return '<path pathLength="1" style="--i:' + (i++) + '" d="' + d + '"/>'; }
    function C(r) { return '<circle pathLength="1" style="--i:' + (i++) + '" r="' + r + '"/>'; }
    var a = '', b = '', c = '', s = '', k;
    /* outer bezel: 180 minor ticks, 36 majors, four cardinals, a degree scale */
    a += P(ticks(46.9, 48.3, 180)) + P(ticks(45.3, 48.3, 36)) + P(ticks(44.4, 48.3, 4));
    a += C(48.9) + C(44.4) + C(41.4) + C(37.6);
    for (k = 0; k < 12; k++) {
      var ang = k * 30, rad = ang / 360 * TAU - Math.PI / 2, tx = f1(42.9 * Math.cos(rad)), ty = f1(42.9 * Math.sin(rad));
      a += '<text class="deg" x="' + tx + '" y="' + ty + '" transform="rotate(' + ang + ' ' + tx + ' ' + ty + ')" text-anchor="middle" dominant-baseline="central">' + ('00' + ang).slice(-3) + '</text>';
    }
    var mp = ''; for (k = 0; k < 5; k++) mp += 'SAMPLE DATA · NOTHING IS PAID · ';
    a += '<defs><path id="mpc" d="M0 -39.5 A39.5 39.5 0 1 1 -0.01 -39.5"/></defs><text><textPath href="#mpc" textLength="246" lengthAdjust="spacing">' + mp + '</textPath></text>';
    /* the graticule: a vernier pair (120 against 108 ticks), a dashed range ring, twelve spokes */
    b += P(ticks(34.4, 36.1, 120)) + P(ticks(31.4, 33.0, 108)) + P(dashes(29.2, 72, .45));
    b += C(33.7) + C(25.2) + C(21.6);
    b += P(ticks(21.6, 34.4, 12, 1 / 24));
    /* the reticle */
    c += P('M-19 0H-6M6 0H19M0 -19V-6M0 6V19') + P(ticks(11.8, 13.4, 48)) + P(ticks(10.6, 13.4, 8));
    c += C(16.8) + C(12.6) + C(3.2);
    c += P('M-1.2 0H1.2M0 -1.2V1.2');
    /* the signal sweep: a soft trailing wedge and its leading edge */
    for (k = 0; k < 8; k++) {
      var a0 = -Math.PI / 2 - (k + 1) * .07, a1 = -Math.PI / 2 - k * .07;
      s += '<path class="wedge" style="fill:currentColor;fill-opacity:' + f1(.15 * Math.pow(.72, k)) + ';stroke:none" d="M0 0L' + pol(36, a0) + 'A36 36 0 0 1 ' + pol(36, a1) + 'Z"/>';
    }
    s += '<path class="edge" d="M0 -3.2L0 -36"/>';
    var vb = 'viewBox="-50 -50 100 100" aria-hidden="true"';
    core.innerHTML = '<svg class="band bS" ' + vb + '>' + s + '</svg><svg class="band bA" ' + vb + '>' + a + '</svg><svg class="band bB" ' + vb + '>' + b + '</svg><svg class="band bC" ' + vb + '>' + c + '</svg>' +
      '<svg class="arc" viewBox="-50 -50 100 100" aria-hidden="true"><circle class="trk" r="52.5"/><circle class="lft" id="arcl" r="52.5" pathLength="1" transform="rotate(-90)"/></svg>';
    var br = mark();
    if (brand) brand.setAttribute('d', br);
    (minis || []).forEach(function (p) { p.setAttribute('d', br); });
  }
  /* the brand mark: a reticle inside the bezel, 24 ticks */
  function mark() { return 'M0 -7.4V-3M0 7.4V3M-7.4 0H-3M7.4 0H3' + ticks(8.6, 10.5, 24) + 'M-.9 0H.9M0 -.9V.9'; }
  function miniseal() {
    return '<svg viewBox="-12 -12 24 24" style="width:1.2rem;height:1.2rem" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width=".9"><circle r="10.5"/><path d="' + mark() + '"/></g></svg>';
  }
  /* hold to confirm: four tick rings that fill like a gauge */
  function rosette() {
    var s = '<svg viewBox="-24 -24 48 48" aria-hidden="true">', i;
    for (i = 0; i < 4; i++) s += '<circle r="' + (8 + i * 4) + '"/>';
    for (i = 0; i < 4; i++) s += '<path pathLength="1" d="' + ticks(6.6 + i * 4, 9.2 + i * 4, 16 + i * 8) + '"/>';
    return s + '</svg>';
  }

  /* ------------------------------------------------ textures: graticule paper, a ruler for the foil */
  var cache = {};
  function tex(color, op, kind) {
    var col = resolve(color), key = col + op + (kind || '');
    if (cache[key]) return cache[key];
    var s, k;
    if (kind === 'ruler') {
      s = "<svg xmlns='http://www.w3.org/2000/svg' width='40' height='19' viewBox='0 0 40 19'><g stroke='" + col + "' stroke-opacity='" + op + "' stroke-width='1'>";
      for (k = 0; k < 10; k++) s += "<path d='M" + (k * 4 + .5) + " 19V" + (k % 5 === 0 ? 8 : 14) + "'/>";
      s += '</g></svg>';
    } else {
      s = "<svg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 48 48'><g fill='none' stroke='" + col + "'>";
      var d = ''; for (k = 1; k < 6; k++) d += 'M' + (k * 8) + ' 0V48M0 ' + (k * 8) + 'H48';
      s += "<path d='" + d + "' stroke-opacity='" + f1(op * .4) + "' stroke-width='.5'/>";
      s += "<path d='M.25 0V48M0 .25H48' stroke-opacity='" + f1(op * 1.3) + "' stroke-width='.5'/>";
      s += "<path d='M45 .25H51M.25 45V51M-3 .25H3M.25 -3V3' stroke-opacity='" + f1(Math.min(1, op * 2)) + "' stroke-width='.8'/>";
      s += '</g></svg>';
    }
    return (cache[key] = 'url("data:image/svg+xml,' + encodeURIComponent(s) + '")');
  }

  /* ------------------------------------------------ key art: a calibration plate per layer (stylised) */
  function art(key, mod, esc) {
    var h1 = 'd1' + key, h2 = 'd2' + key, cl = 'dc' + key;
    function sh(d, h) { return '<path d="' + d + '" style="fill:var(--disc)" stroke="none"/><path d="' + d + '" fill="url(#' + (h === 2 ? h2 : h1) + ')" stroke="none"/><path d="' + d + '"/>'; }
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
      o = sh('M120 20 178 38C178 92 162 132 120 158 78 132 62 92 62 38Z', 1) + '<path d="M120 30 168 45C168 92 154 124 120 146 86 124 72 92 72 45Z" style="fill:var(--disc)"/>' +
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
      o = '<path d="M64 90a56 56 0 1 0 112 0a56 56 0 1 0-112 0ZM94 90a26 26 0 1 1 52 0a26 26 0 1 1-52 0Z" style="fill:var(--disc)" fill-rule="evenodd" stroke="none"/><path d="M64 90a56 56 0 1 0 112 0a56 56 0 1 0-112 0ZM94 90a26 26 0 1 1 52 0a26 26 0 1 1-52 0Z" fill="url(#' + h2 + ')" fill-rule="evenodd"/>' + bands +
        '<path d="' + rope + '" stroke-width="1.1"/><path d="M22 162q12-8 24 0t24 0 24 0 24 0 24 0 24 0 24 0 24 0M34 170q12-8 24 0t24 0 24 0 24 0 24 0 24 0 24 0" stroke-width=".9"/>';
    }
    var grid = '', gx, gy, k;
    for (gx = 30; gx < 222; gx += 12) grid += 'M' + gx + ' 14V166';
    for (gy = 18; gy < 166; gy += 12) grid += 'M18 ' + gy + 'H222';
    var rule = ''; for (k = 0; k <= 32; k++) rule += 'M' + (24 + k * 6) + ' 170V' + (k % 5 === 0 ? 163 : 166.5);
    for (k = 0; k <= 24; k++) rule += 'M14 ' + (18 + k * 6) + 'H' + (k % 5 === 0 ? 21 : 17.5);
    var br = 'M14 22V10H26M214 10H226V22M226 158V170H214M26 170H14V158';
    return '<svg viewBox="0 0 240 180" role="img" aria-label="Stylised engraving: ' + esc(mod.motif) + '"><defs>' +
      '<pattern id="' + h1 + '" width="2.4" height="2.4" patternUnits="userSpaceOnUse"><circle cx="1.2" cy="1.2" r=".42" fill="currentColor"/></pattern>' +
      '<pattern id="' + h2 + '" width="1.8" height="1.8" patternUnits="userSpaceOnUse"><path d="M0 .9H1.8" stroke="currentColor" stroke-width=".4"/></pattern>' +
      '<clipPath id="' + cl + '"><rect x="18" y="14" width="204" height="152"/></clipPath></defs>' +
      '<g clip-path="url(#' + cl + ')"><path d="' + grid + '" stroke="currentColor" stroke-width=".4" opacity=".2"/>' +
      '<path d="M120 14V166M18 90H222" stroke="currentColor" stroke-width=".5" opacity=".34" stroke-dasharray="2 3"/></g>' +
      '<rect x="14" y="10" width="212" height="160" fill="none" stroke="currentColor" stroke-width=".6" opacity=".45"/>' +
      '<path d="' + br + '" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
      '<path d="' + rule + '" fill="none" stroke="currentColor" stroke-width=".6" opacity=".6"/>' +
      '<circle cx="206" cy="28" r="5" fill="none" stroke="currentColor" stroke-width=".6" opacity=".6"/><path d="M199 28h14M206 21v14" stroke="currentColor" stroke-width=".5" opacity=".6"/>' +
      '<g fill="none" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round" stroke-linecap="round">' + o + '</g></svg>';
  }

  /* the layers take their colours from the theme's tokens, so light and dark re-derive them */
  var T = window.TABLE;
  if (T && T.MODULES) T.MODULES.forEach(function (m) { m.color = 'var(--m-' + m.key + ')'; });

  window.DECO = { seal: seal, miniseal: miniseal, rosette: rosette, tex: tex, art: art, resolve: resolve };
})();
