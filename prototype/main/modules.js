/* The Table · main window surfaces on the shared v2 baseline (shared/ui.css + shared/ui.js):
   six module screens, one deal view, the approval window, sheets and find.
   Two layers: Layer 1 is indicative rows and chips (id · who · amount · state · default on
   silence); detail opens on demand in UI.sheet / UI.popover. The home scene (The Dial) lives in
   index.html and talks to this file through window.App. All data is sandbox sample data
   (fixtures.js). Colours come only from tokens (CSS variables), so the light theme works. */
(function () {
  'use strict';
  const F = window.FIX;
  const T0 = Date.now();
  const NOW0 = new Date(F.nowISO).getTime();
  const simNow = () => NOW0 + (Date.now() - T0);
  const MIN = 60000, HOUR = 60 * MIN;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- theme (only this page shows the switch) ---------------- */
  const THEME_KEY = 'table-theme';
  const theme = {
    get: () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'),
    set(t) {
      if (t === 'light') document.documentElement.dataset.theme = 'light';
      else delete document.documentElement.dataset.theme;
      try { localStorage.setItem(THEME_KEY, t === 'light' ? 'light' : 'dark'); } catch (e) { /* storage blocked: the switch still works for this view */ }
      document.querySelectorAll('[data-theme-set]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themeSet === theme.get())));
    },
    seg: () => `<div class="ui-seg" role="group" aria-label="Appearance">${['dark', 'light'].map(t => `<button data-theme-set="${t}" aria-pressed="${theme.get() === t}">${t === 'dark' ? 'Dark' : 'Light'}</button>`).join('')}</div>`
  };
  document.addEventListener('click', e => { const b = e.target.closest('[data-theme-set]'); if (b) theme.set(b.dataset.themeSet); });

  /* ---------------- modules + their drawn motifs ---------------- */
  const MODULES = [
    { key: 'tables',  name: 'Tables',  long: 'Haggle',               color: 'var(--m-tables)', week: 'Mon', cap: 9,
      line: 'Your agent bargains with another wallet’s agent, only inside the band you signed.', decision: 'Set the band: ceiling when buying, floor when selling, rounds and deadline.' },
    { key: 'spend',   name: 'Spend',   long: 'Spend firewall',       color: 'var(--m-spend)', week: 'Tue', cap: 1,
      line: 'Every purchase an agent asks for meets the gate first. Money is held, then captured or voided.', decision: 'Capture or void a held authorization inside its 3-day honor period.' },
    { key: 'counter', name: 'Counter', long: 'Agent-ready shop',     color: 'var(--m-counter)', week: 'Thu', cap: 3,
      line: 'Your shop sits at the table for other people’s agents. Your floors are your seller mandate.', decision: 'Set the floor price per item. The quoting agent can never go below it.' },
    { key: 'book',    name: 'Book',    long: 'Payments ops cockpit', color: 'var(--m-book)', week: 'Sun', cap: 5,
      line: 'Every deal, its PayPal evidence, and whether PayPal’s statement agrees yet.', decision: 'Ask, read the structured query, then run it read-only.' },
    { key: 'shield',  name: 'Shield',  long: 'Scam shield',          color: 'var(--m-shield)', week: 'Wed', cap: 7,
      line: 'A second opinion vets who sits down before the wallet countersigns. It can refuse, never grant.', decision: 'Release a HOLD by typing the payee’s name, or leave it. A BLOCK has no release.' },
    { key: 'rescue',  name: 'Rescue',  long: 'Subscription rescue',  color: 'var(--m-rescue)', week: 'Fri', cap: 8,
      line: 'Failed care-plan renewals get one lever for one subscriber, never a plan-wide price change.', decision: 'Approve the suggested lever: it creates one PayPal invoice and opens your email draft.' }
  ];
  const MOD = Object.fromEntries(MODULES.map(m => [m.key, m]));

  // Small module glyphs (sidebar, page heads). Colours as CSS in style attributes, never hex.
  function glyph(key, cls) {
    const c = MOD[key].color;
    const st = (col, w, extra) => `fill="none" style="stroke:${col}" stroke-width="${w}" stroke-linecap="round" ${extra || ''}`;
    const g = {
      tables: `<path d="M8 40c6-10 12-14 18-14" ${st('var(--teal)', 4)}/><path d="M56 40c-6-10-12-14-18-14" ${st('var(--coral)', 4)}/><circle cx="32" cy="26" r="7" style="fill:var(--gold)"/><path d="M6 48h52M14 48v8M50 48v8" ${st(c, 3)}/>`,
      spend: `<path d="M10 56V22a22 14 0 0 1 44 0v34" ${st(c, 3.5)}/><path d="M20 20v36M32 13v43M44 20v36M10 34h44M10 46h44" ${st(c, 2.4, 'opacity=".75"')}/><rect x="26" y="38" width="12" height="9" rx="2" style="fill:var(--gold)"/>`,
      counter: `<path d="M6 44h52v6H6z" style="fill:${c}"/><path d="M10 50v8M54 50v8" ${st(c, 3)}/><path d="M22 40a10 10 0 0 1 20 0z" ${st(c, 3)}/><circle cx="32" cy="27" r="2.6" style="fill:${c}"/><path d="M14 12h36l-4 10H18z" ${st(c, 2.4, 'opacity=".7"')}/>`,
      book: `<path d="M32 16c-8-5-16-6-24-5v38c8-1 16 0 24 5 8-5 16-6 24-5V11c-8-1-16 0-24 5z" ${st(c, 3)}/><path d="M32 16v38" ${st(c, 2)}/><path d="M14 22h12M14 29h12M14 36h9M38 22h12M38 29h8M38 36h12" ${st(c, 2, 'opacity=".7"')}/><circle cx="46" cy="43" r="3" style="fill:var(--gold)"/>`,
      shield: `<path d="M32 6v6" ${st(c, 3)}/><path d="M22 14h20l4 8v22l-4 8H22l-4-8V22z" ${st(c, 3)}/><path d="M32 24c5 6 6 10 0 18-6-8-5-12 0-18z" style="fill:${c}" opacity=".9"/><path d="M14 58h36" ${st(c, 3)}/>`,
      rescue: `<circle cx="32" cy="32" r="19" ${st(c, 9, 'stroke-dasharray="14.9 14.9" stroke-linecap="butt"')}/><circle cx="32" cy="32" r="19" ${st(c, 1.5, 'opacity=".6"')}/><path d="M48 50c6 4 8 8 8 10" ${st('var(--gold)', 2.2)}/>`
    }[key];
    return `<svg class="${cls || 'g'}" viewBox="0 0 64 64" aria-hidden="true">${g}</svg>`;
  }

  /* ---------------- state ---------------- */
  const S = { level: 0, module: null, deal: null, locked: false, engine: F.owner.engine, ceiling: F.haggle.ceiling, draft: null, mandateV: 3,
              recovered: 0, book: { phase: 'idle', q: '', qid: 0 }, rescueSel: 'S-14', lever: 'DISCOUNT_THIS_CYCLE', listeners: [] };
  const deals = F.deals.map(d => Object.assign({}, d));
  const byId = id => deals.find(d => d.id === id);
  const at = {
    'D-0193': NOW0 + 3 * HOUR + 58 * MIN, // deadline 18:00
    'D-0190': NOW0 + 2 * 24 * HOUR + 19 * HOUR,
    'Q-0207': NOW0 + 10 * MIN,
    'D-0198': NOW0 + 5 * HOUR + 58 * MIN, // 20:00
    'D-0189': NOW0 + 4 * HOUR + 31 * MIN
  };
  const emit = () => { S.listeners.forEach(f => { try { f(S); } catch (e) { console.error(e); } }); };

  /* ---------------- formatting ---------------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money0 = n => n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: n % 1 ? 2 : 0, minimumFractionDigits: n % 1 ? 2 : 0 });
  function dur(ms, long) {
    if (ms <= 0) return '0:00';
    const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
    if (d > 0) return `${d} d ${h} h ${String(m).padStart(2, '0')} m`;
    if (long || h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    return `${m}:${String(ss).padStart(2, '0')}`;
  }
  const cd = (until, long) => `<span class="cd mono" data-until="${until}" data-long="${long ? 1 : 0}">${dur(until - simNow(), long)}</span>`;
  const clock = () => { const d = new Date(simNow()); return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); };

  const STATE_CLASS = {
    NEGOTIATING: 'live', QUOTED: 'live', PAIRING: 'live', LISTED: 'live', SETTLING: 'live', AGREED: 'live', CHECKOUT: 'live',
    'AWAITING APPROVAL': 'wait', 'AWAITING BUYER APPROVAL': 'wait', 'IN BROWSER': 'wait', APPROVED: 'wait', 'OFFER SENT': 'wait', FAILED: 'wait', 'SELLER-ATTESTED': 'wait', ASK: 'wait',
    AUTHORIZED: 'held', HOLD: 'held',
    CAPTURED: 'done', RECEIPTED: 'done', RECOVERED: 'done', RECONCILED: 'done', 'RETRY SUCCEEDED': 'done', PAUSED: 'done', CLEAR: 'done',
    REFUSED: 'bad', BLOCK: 'bad', MISMATCH: 'bad', LOST: 'bad',
    WITHDRAWN: 'off', VOIDED: 'off', EXPIRED: 'off', 'AUTO-VOIDED': 'off'
  };
  const CHIP = { live: 'teal', wait: 'gold', held: 'gold held', done: 'ok', bad: 'red', off: '' };
  const chipCls = s => CHIP[STATE_CLASS[s] || 'off'];
  const st = (s, extra) => `<span class="ui-chip ${chipCls(s)}">${esc(s)}${extra ? ' · ' + esc(extra) : ''}</span>`;
  const replayBadge = d => d.replay ? '<span class="badge replay" title="Detected from a replayed sandbox event">Replay</span>' : '';
  const cpName = d => (F.counterparties[d.cp] && F.counterparties[d.cp].name) || (d.cp && d.cp.startsWith('S-') ? 'subscriber ' + d.cp : d.cp);
  // How an amount must read: proposed vs held vs moved vs refused never look alike.
  function amtCls(d) {
    if (d.state === 'REFUSED' || d.state === 'BLOCK' || d.state === 'VOIDED' || d.state === 'WITHDRAWN' || d.state === 'EXPIRED') return 'struck';
    if (['CAPTURED', 'RECEIPTED', 'RECOVERED', 'RECONCILED'].includes(d.state)) return '';
    return 'proposed';
  }
  function amtNote(d) {
    if (d.amount == null) return d.ask ? d.ask + ' · refused' : 'no amount yet';
    if (d.state === 'AUTHORIZED') return 'held at PayPal';
    if (d.state === 'HOLD') return 'held by shield';
    if (['CAPTURED', 'RECEIPTED', 'RECONCILED'].includes(d.state)) return d.side === 'seller' ? 'paid to you' : 'paid';
    if (d.state === 'RECOVERED') return 'recovered';
    if (['REFUSED', 'BLOCK'].includes(d.state)) return 'never sent';
    if (d.state === 'VOIDED') return 'voided';
    if (d.state === 'QUOTED') return 'quote only';
    return 'proposed';
  }
  const amt = d => `<span class="amt ${amtCls(d)}" title="${esc(amtNote(d))}">${d.amount == null ? (d.ask ? esc(d.ask.replace(/^quoted /, '')) : '—') : money(d.amount)}</span>`;
  // "the offer lapses at 18:00 · no money moves" -> silent → <b>the offer lapses at 18:00</b> · no money moves
  function silence(s, prefix) {
    if (!s) return '';
    const i = s.indexOf(' · ');
    const t = i < 0 ? `<b>${esc(s)}</b>` : `<b>${esc(s.slice(0, i))}</b> · ${esc(s.slice(i + 3))}`;
    return `<span class="ui-silence" title="If you do nothing: ${esc(s)}">${prefix == null ? 'silent → ' : prefix}${t}</span>`;
  }
  const lockSvg = locked => `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7.5" rx="1.6" fill="currentColor"/><path d="${locked ? 'M5 7V5a3 3 0 0 1 6 0v2' : 'M5 7V5a3 3 0 0 1 5.8-1.1'}" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;

  /* ---------------- summary for the home scene ---------------- */
  const PENDING_VERB = { countersign: 'Countersign', capture: 'Capture or void', release: 'Release or keep hold', lever: 'Approve rescue lever', approve: 'Approve in browser' };
  function summary() {
    const needs = deals.filter(d => d.pending).map(d => ({
      id: d.id, module: d.module, verb: PENDING_VERB[d.pending], amount: d.amount, text: `${PENDING_VERB[d.pending]} ${money(d.amount)}`,
      who: cpName(d), item: d.item, silence: d.silence || '', state: d.state, until: at[d.id] || null
    }));
    const inWeek = d => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].includes(d.day);
    const moved = s => ['CAPTURED', 'RECEIPTED', 'RECONCILED'].includes(s);
    const out = deals.filter(d => d.side === 'buyer' && moved(d.state) && inWeek(d)).reduce((a, d) => a + d.amount, 0);
    const inn = deals.filter(d => d.side === 'seller' && moved(d.state)).reduce((a, d) => a + d.amount, 0) + S.recovered;
    const held = deals.filter(d => d.state === 'AUTHORIZED' || d.state === 'HOLD').map(d => ({ id: d.id, amount: d.amount, kind: d.state === 'AUTHORIZED' ? 'authorized at PayPal' : 'held by shield · no PayPal call', module: d.module, item: d.item, state: d.state }));
    const moving = deals.filter(d => ['live', 'wait'].includes(STATE_CLASS[d.state]) && !d.pending).map(d => ({ id: d.id, state: d.state, amount: d.amount, module: d.module, item: d.item }));
    const stopped = deals.filter(d => d.state === 'REFUSED' || d.state === 'BLOCK');
    const perModule = {};
    MODULES.forEach(m => {
      const ds = deals.filter(d => d.module === m.key);
      perModule[m.key] = { count: ds.length, needs: ds.filter(d => d.pending).length, live: ds.filter(d => ['live', 'wait', 'held'].includes(STATE_CLASS[d.state])).length, headline: headline(m.key) };
    });
    return { needs, out, inn, held, moving, stopped, perModule, recovered: S.recovered, locked: S.locked, ceiling: S.ceiling, deal193: byId('D-0193') };
  }
  function headline(key) {
    const d = byId;
    switch (key) {
      case 'tables': { const x = d('D-0193'); return x.pending === 'countersign' ? `Dan asks $329 · inside your $${S.ceiling} band` : `D-0193 · ${x.state.toLowerCase()}`; }
      case 'spend': { const x = d('D-0190'); return x.state === 'AUTHORIZED' ? '$64 dock held · 40 GPUs refused' : `40 GPUs refused · dock ${x.state.toLowerCase()}`; }
      case 'counter': { const q = d('Q-0207'); return q.state === 'QUOTED' ? 'lark’s agent quoted $61 for an arm' : 'floors hold · 12 items'; }
      case 'book': { const s0 = summary0(); return `${money0(s0.out)} out · ${money0(s0.inn)} in this week`; }
      case 'shield': { const x = d('D-0198'); return x.state === 'HOLD' ? '1 hold · 1 block (friends & family)' : '1 block · nothing held'; }
      case 'rescue': { const x = d('D-0188'); return x.state === 'FAILED' ? 'S-14 renewal failed · $9.60 offer ready' : x.state === 'RECOVERED' ? '$9.60 recovered' : 'S-14 offer sent · unpaid'; }
    }
    return '';
  }
  function summary0() {
    const moved = s => ['CAPTURED', 'RECEIPTED', 'RECONCILED'].includes(s);
    return { out: deals.filter(d => d.side === 'buyer' && moved(d.state)).reduce((a, d) => a + d.amount, 0),
             inn: deals.filter(d => d.side === 'seller' && moved(d.state)).reduce((a, d) => a + d.amount, 0) + S.recovered };
  }

  /* ---------------- DOM scaffolding ---------------- */
  let cfg = {};
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  function ensureDom() {
    if ($('#app')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div id="app" hidden></div>
      <div id="approvalLayer" hidden></div>
      <div id="palette" hidden><div class="pbox" role="dialog" aria-label="Find"><input id="palIn" placeholder="Find a deal, counterparty, subscriber or module…" autocomplete="off"><ul id="palList"></ul></div></div>`);
  }
  // Toasts carry our own strings (dynamic parts escaped at the call site), so a small HTML node is fine.
  function toast(html, kind) { const n = document.createElement('span'); n.innerHTML = html; UI.toast(n, kind); }

  function topbar(crumbs) {
    const s = summary();
    return `<header class="ui-titlebar">
      <button class="ui-btn sm" data-act="home" title="Back to The Table (Esc from a module)">‹ The Table <span class="kbd">Esc</span></button>
      <nav class="ui-crumbs" aria-label="Breadcrumb">${crumbs}</nav>
      <span class="ui-spacer"></span>
      <span class="badge sandbox" title="Every screen carries its mode">Sandbox</span>
      <span class="badge mock tb-hide">sample data</span>
      <div class="tb-meter" title="Wallet spend: dollars your agents moved this week (captured only)"><b>${money(s.out)} out · ${money(s.inn)} in</b><span>wallet · captured</span></div>
      <div class="tb-meter eng" title="The engine CLI's own client-side estimate; never used for money decisions"><b>~$${F.engineWeekUSD.toFixed(2)}</b><span>${esc(S.engine)} · not a bill</span></div>
      <button class="ui-btn sm" data-act="find" title="Find (Ctrl+K)">Find <span class="kbd">Ctrl K</span></button>
      <button class="ui-btn sm lockbtn ${S.locked ? 'is-locked' : ''}" data-act="lock" title="${S.locked ? 'Locked after 15 idle minutes (simulated). Click to unlock.' : 'Privileged actions lock after 15 idle minutes. Click to simulate.'}">${lockSvg(S.locked)}${S.locked ? 'Locked' : 'Unlocked'}</button>
    </header>`;
  }
  function rail() {
    const s = summary();
    return `<nav class="ui-sidebar" aria-label="Modules"><div class="ui-sb-head">Modules</div>${MODULES.map((m, i) => {
      const p = s.perModule[m.key];
      return `<button class="ui-sb-item ${S.module === m.key ? 'on' : ''}" style="--mc:${m.color}" data-mod="${m.key}" title="${esc(m.long)} · key ${i + 1}" ${S.module === m.key ? 'aria-current="page"' : ''}>
        <span class="ico">${glyph(m.key)}</span><span class="lbl">${m.name}</span><span class="cnt ${p.needs ? 'need' : ''}" title="${p.needs ? p.needs + ' need you' : p.count + ' deals'}">${p.needs ? p.needs : p.count}</span></button>`;
    }).join('')}
    <div class="ui-sb-foot"><button class="ui-sb-item" data-act="mandates"><span class="lbl">Mandates</span><span class="cnt">M-12 v${S.mandateV}</span></button><button class="ui-sb-item" data-act="audit"><span class="lbl">Audit log</span></button><button class="ui-sb-item" data-act="settings"><span class="lbl">Settings</span><span class="cnt">${esc(S.engine)}</span></button></div></nav>`;
  }

  /* ---------------- navigation ---------------- */
  function open(key, opts) {
    ensureDom();
    const first = S.level === 0;
    S.level = 1; S.module = key; S.deal = null;
    render();
    const app = $('#app');
    if (first) { app.hidden = false; app.classList.remove('leave'); if (!reduce) { app.classList.add('enter'); setTimeout(() => app.classList.remove('enter'), 600); } if (cfg.onLeave) cfg.onLeave(key); }
    if (!(opts && opts.keepFocus)) setTimeout(() => { const h = $('#app h1'); h && h.focus({ preventScroll: true }); }, 30);
  }
  function openDeal(id, opts) {
    const d = byId(id); if (!d) return;
    const fromHome = S.level === 0;
    S.module = d.module; S.deal = id; S.level = 2;
    if (fromHome) { ensureDom(); const app = $('#app'); app.hidden = false; if (!reduce) { app.classList.add('enter'); setTimeout(() => app.classList.remove('enter'), 600); } if (cfg.onLeave) cfg.onLeave(d.module); }
    render();
    setTimeout(() => { const h = $('#app h1'); h && h.focus({ preventScroll: true }); }, 30);
    if (opts && opts.decide) setTimeout(() => decide(id), 250);
  }
  function goHome() {
    const app = $('#app'); if (!app || S.level === 0) return;
    S.level = 0; const was = S.module; S.module = null; S.deal = null;
    const done = () => { app.hidden = true; app.classList.remove('leave'); app.innerHTML = ''; if (cfg.onReturn) cfg.onReturn(was); emit(); };
    if (reduce) done(); else { app.classList.add('leave'); setTimeout(done, 340); }
  }
  function back() {
    if (!$('#palette').hidden) return closePalette();
    if (!$('#approvalLayer').hidden) return closeApproval();
    if (S.level === 2) { S.level = 1; S.deal = null; render(); return; }
    if (S.level === 1) return goHome();
  }

  function render() {
    const app = $('#app'); if (!app || S.level === 0) { emit(); return; }
    const m = MOD[S.module];
    let crumbs = `<button data-act="home">The Table</button><span class="sep">›</span>`;
    if (S.level === 1) crumbs += `<span>${m.name}</span>`;
    else crumbs += `<button data-mod="${m.key}">${m.name}</button><span class="sep">›</span><span>${esc(S.deal)}</span>`;
    const view = $('main.view', app), scroll = view ? view.scrollTop : 0;
    app.style.setProperty('--mc', m.color);
    app.innerHTML = topbar(crumbs) + `<div class="ui-split">${rail()}<main class="ui-main view" tabindex="-1"><div class="view-inner">${S.level === 1 ? VIEWS[S.module]() : dealView(byId(S.deal))}</div></main></div>`;
    if (S._keepScroll) $('main.view', app).scrollTop = scroll;
    S._keepScroll = false;
    wire(app);
    requestAnimationFrame(fitBands); // after the window is shown, so bands can measure their box
    emit();
  }
  const rerender = () => { S._keepScroll = true; render(); };

  /* ---------------- Layer 1 building blocks ---------------- */
  function moduleHead(key, actions) {
    const m = MOD[key];
    return `<div class="ui-pagehead mhead" style="--mc:${m.color}"><span class="mico">${glyph(key)}</span><h1 tabindex="-1">${m.name}</h1>
      <span class="sub">${esc(m.long)} · capability ${m.cap}</span><button class="ui-btn plain sm" data-pop="about:${key}" aria-label="About ${m.name}">ⓘ</button>
      <div class="actions">${actions || ''}</div></div>`;
  }
  const section = (title, end, body, cls) => `<div class="ui-section ${cls || ''}"><div class="ui-section-h"><h2>${title}</h2>${end ? `<span class="end">${end}</span>` : ''}</div>${body}</div>`;
  const group = (rows, empty) => `<div class="ui-group">${rows || `<div class="ui-empty">${empty || 'Nothing here.'}</div>`}</div>`;
  function row(d) {
    return `<div class="ui-row two act ${d.pending ? 'need' : ''}" data-deal="${d.id}" tabindex="0" role="link" aria-label="${esc(d.id + ' ' + d.item)}"><span class="id">${d.id}</span>
      <span class="main"><span class="t1">${esc(d.item)}</span><span class="t2">${esc(cpName(d))} · ${esc(d.sub || '')}</span></span>
      ${d.note ? `<button class="ui-chip coral chipbtn" data-pop="note:${d.id}" title="Counterparty text, untrusted">note ›</button>` : ''}
      ${amt(d)}${st(d.state)}${replayBadge(d)}<span class="chev"></span></div>`;
  }
  // The one decision on Layer 1: one row, its default on silence, its buttons.
  function decisionBar(d, title, buttons, cls) {
    return `<div class="ui-group need-group ${cls || ''}"><div class="ui-row two"><span class="ui-chip ${cls === 'bad' ? 'red' : 'gold'}">${cls === 'bad' ? 'Stopped' : 'Needs you'}</span>
      <span class="main"><span class="t1">${title}</span>${silence(d.silence) || '<span class="ui-silence">no money moves</span>'}</span><span class="acts">${buttons}</span></div></div>`;
  }
  // Main-window money buttons only hand off: they open the approval window.
  function privBtn(label, act, kind) {
    return S.locked ? `<button class="ui-btn gold locked" data-act="unlock" title="Privileged actions need an OS re-auth after 15 idle minutes">Unlock with Windows Hello</button>`
      : `<button class="ui-btn ${kind || 'gold'}" data-act="${act}" title="Opens the approval window, the only window that can release money">${esc(label)} ↗</button>`;
  }

  /* ---------------- Layer 2: popovers ---------------- */
  const quarantine = (label, text) => `<div class="quarantine"><div class="q-label">${esc(label)}</div><div class="q-text">${esc(text)}</div></div>`;
  const POPS = {
    about(key) { const m = MOD[key]; return { title: `${m.long} · capability ${m.cap}`, body: `<p style="margin:0 0 8px">${esc(m.line)}</p><dl class="ui-kv"><dt>The one decision</dt><dd>${esc(m.decision)}</dd></dl>` }; },
    note(id) { const d = byId(id); return { title: `${cpName(d)} wrote`, body: quarantine('Untrusted · counterparty text, plain text only', d.note) + '<p class="ui-hint" style="margin:6px 0 0">Never shown to an agent as instructions.</p>' }; },
    why(id) {
      const d = byId(id);
      if (id === 'D-0190') return { title: 'Why the dock waits for you', body: `<dl class="ui-kv"><dt>Clause 7</dt><dd>the payee dockparts.example is not on your allowlist, so the policy cannot countersign the capture</dd><dt>Held</dt><dd>authorization ${esc(d.pp.auth)} · ${money(d.amount)} · honor period ${cd(at[id])}</dd><dt>Route</dt><dd>${esc(d.route)}</dd><dt>Agent</dt><dd>supplies agent · test-bench dock</dd></dl>` };
      return { title: `${d.id} · ${d.item}`, body: `<dl class="ui-kv"><dt>Why</dt><dd>${esc(d.sub)}</dd><dt>Money now</dt><dd>${esc(d.money)}</dd></dl>` };
    },
    clauses() { return { title: 'Clauses on this deal', body: `<div class="ui-group">${[[4, 'band: $329 fits under the ceiling'], [6, 'ask over $250, so the countersign is yours'], [2, 'paired counterparties only']].map(([n, t]) => `<div class="ui-row"><span class="clause">${n}</span><span class="clip">${t}</span></div>`).join('')}</div>` }; },
    market(id) { const d = byId(id), mk = F.market[d.ref]; return { title: 'Market reference', body: `<dl class="ui-kv"><dt>Band</dt><dd class="money">p25 ${money0(mk.p25)} · median ${money0(mk.median)} · p75 ${money0(mk.p75)}</dd><dt>Source</dt><dd>${esc(mk.src)}</dd><dt>Retrieved</dt><dd>${esc(mk.retrieved)}${mk.tracking ? ' · ' + esc(mk.tracking) : ''}</dd>${d.amount ? `<dt>This deal</dt><dd>${money0(d.amount)} = ${pctOf(d.amount, mk)}</dd>` : ''}</dl><p class="ui-hint" style="margin:6px 0 0">Context only. The market never decides; your mandate does.</p>` }; },
    request() { return { title: 'The agent’s request', body: quarantine('Untrusted · the agent’s request, quoted', 'propose_purchase{ item: "GPU A100 80GB, 1 month", qty: 40, merchant: "gpu-cloud.example" }') + '<p class="ui-hint" style="margin:6px 0 0">The refusal went back to the agent as “clause 3: max_amount $200 per deal; category compute not allowed”.</p>' }; },
    quote() { return { title: 'Q-0207 · how a sale closes', body: '<p style="margin:0">If lark’s owner checks out, the shop issues a PayPal order and their owner approves it in their own browser. Nothing for you to approve per sale: receiving money needs no click.</p>' }; },
    floors() { return { title: 'Floors', body: '<p style="margin:0 0 6px">A quote below floor can’t be produced, so there is no error state for it.</p><p class="ui-hint" style="margin:0">The feed follows Store Sync field names and is exported, not uploaded.</p>' }; },
    shieldtext() { return { title: 'The text check', body: `<p style="margin:0">${esc(S.engine)} runs with no tools and no MCP servers; its verdict can only add caution. If no engine is set up: “model check skipped”, the rules still run.</p>` }; },
    replay() { return { title: 'Replay', body: '<p style="margin:0">The failure was detected from a replayed sandbox event. The invoice that follows is real sandbox money; replay rows never count as recovered on their own.</p>' }; },
    gate() { return { title: 'The gate', body: '<p style="margin:0">Checked in Rust before every create, authorize and capture. PayPal has no per-agent budgets; this is the policy.</p>' }; }
  };
  function showPop(el) {
    const [k, arg] = el.dataset.pop.split(':');
    const p = POPS[k] && POPS[k](arg); if (!p) return;
    UI.popover(el, p.body, { title: p.title });
  }

  /* ---------------- band chart (shared, draggable ceiling, drawn 1:1) ---------------- */
  function bandChart(opts) {
    opts = opts || {};
    const H = F.haggle, mk = F.market['monitor-27-4k'];
    const W = Math.max(320, Math.round(opts.w || 560)), Ht = opts.h || 220, L = 44, R = 66, T = 20, B = 12;
    const lo = 280, hi = 400, id = opts.id || 'b';
    const y = p => T + (hi - p) / (hi - lo) * (Ht - T - B);
    const x = s => L + (s - 1) / 11 * (W - L - R);
    const ceil = S.draft != null ? S.draft : S.ceiling;
    const env = H.envelopes, last = env[env.length - 1];
    const d = byId('D-0193');
    const done = ['AGREED', 'SETTLING', 'AWAITING APPROVAL', 'IN BROWSER', 'APPROVED', 'SELLER-ATTESTED', 'RECEIPTED'].includes(d.state);
    const fits = last.price <= ceil;
    const bids = env.filter(e => e.by === 'you'), asks = env.filter(e => e.by === 'them');
    const path = arr => arr.map((e, i) => `${i ? 'L' : 'M'}${x(e.seq).toFixed(1)} ${y(e.price).toFixed(1)}`).join(' ');
    let grid = '';
    for (let p = 280; p <= 400; p += 20) grid += `<line class="bc-grid" x1="${L}" x2="${W - R}" y1="${y(p)}" y2="${y(p)}"/><text x="${L - 6}" y="${y(p) + 4}" text-anchor="end">$${p}</text>`;
    return `<svg viewBox="0 0 ${W} ${Ht}" width="${W}" height="${Ht}" role="img" aria-label="Offers converging inside your band. Ceiling ${ceil} dollars, latest ask ${last.price} dollars.">
      <defs><pattern id="bc-hatch-${id}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line class="bc-hatch" x1="0" y1="0" x2="0" y2="8" stroke-width="3"/></pattern>
      <linearGradient id="bc-fill-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="bc-fill-a"/><stop offset="1" class="bc-fill-b"/></linearGradient></defs>
      ${grid}
      <rect x="${L}" y="${y(ceil)}" width="${W - L - R}" height="${Ht - B - y(ceil)}" fill="url(#bc-fill-${id})"/>
      <rect x="${L}" y="${y(mk.p75)}" width="${W - L - R}" height="${y(mk.p25) - y(mk.p75)}" fill="url(#bc-hatch-${id})"/>
      <text class="bc-mk" x="${L + 6}" y="${y(mk.p25) + 15}">market p25–p75 $${mk.p25}–$${mk.p75}</text>
      <path class="bc-ask" d="${path(asks)}" stroke-width="2" fill="none" opacity=".8"/>
      <path class="bc-bid" d="${path(bids)}" stroke-width="2" fill="none" opacity=".8"/>
      ${asks.map(e => `<circle class="bc-askpt" cx="${x(e.seq)}" cy="${y(e.price)}" r="4"><title>#${e.seq} Dan ${e.typ} $${e.price}</title></circle>`).join('')}
      ${bids.map(e => `<circle class="bc-bidpt" cx="${x(e.seq)}" cy="${y(e.price)}" r="4"><title>#${e.seq} your ${e.typ} $${e.price}</title></circle>`).join('')}
      <g><circle class="bc-deal ${fits ? '' : 'no'}" cx="${x(last.seq)}" cy="${y(last.price)}" r="${done ? 10 : 9}" fill="none" stroke-width="2.5" ${fits && !done && !reduce ? 'style="animation:pulse 1.8s ease-in-out infinite"' : ''}/>
      <text class="bc-deal-t ${fits ? '' : 'no'}" x="${x(last.seq) - 12}" y="${y(last.price) + 22}" text-anchor="middle">$${last.price}${fits ? '' : ' · unsignable'}</text></g>
      <line class="bc-ceil" x1="${L}" x2="${W - R + 6}" y1="${y(ceil)}" y2="${y(ceil)}" stroke-width="2" stroke-dasharray="${S.draft != null && S.draft !== S.ceiling ? '6 5' : '0'}"/>
      <text class="bc-ceil-t" x="${W - R + 6}" y="${y(ceil) - 15}" style="font-weight:400">ceiling</text>
      <g class="handle" tabindex="0" role="slider" aria-label="Mandate ceiling" aria-valuemin="300" aria-valuemax="390" aria-valuenow="${ceil}" data-y0="${T}" data-y1="${Ht - B}">
        <rect class="hring" x="${W - R + 6}" y="${y(ceil) - 11}" width="${R - 8}" height="22" rx="11"/>
        <text class="bc-ceil-t" x="${W - R / 2 + 2}" y="${y(ceil) + 4}" text-anchor="middle">$${ceil}</text></g>
    </svg>`;
  }
  function bandVerdict() {
    const last = F.haggle.envelopes[F.haggle.envelopes.length - 1].price;
    const ceil = S.draft != null ? S.draft : S.ceiling;
    const drafting = S.draft != null && S.draft !== S.ceiling;
    let h;
    if (last > ceil) h = `<div class="verdict no">✗ <span class="clause">4</span> ${money(last)} is above the ceiling ${money(ceil)} · the core would refuse to sign ACCEPT</div>`;
    else h = `<div class="verdict ok">✓ <span class="clause">4</span> ${money(last)} fits under ${money(ceil)} · <span class="clause">6</span> over $250, so the countersign is yours</div>`;
    if (drafting) h += `<div class="verdict draft">Draft ceiling ${money(ceil)} is <b>not signed</b> · live: M-12 v${S.mandateV} at ${money(S.ceiling)}<span class="end"><button class="ui-btn sm plain" data-act="resetdraft">Discard</button><button class="ui-btn sm" data-act="mandates">Review &amp; sign v${S.mandateV + 1}</button></span></div>`;
    return h;
  }
  function wireBand(root) {
    $$('.handle', root).forEach(h => {
      const svg = h.closest('svg');
      const y0 = +h.dataset.y0, y1 = +h.dataset.y1;
      const set = v => { v = Math.max(300, Math.min(390, Math.round(v))); if (v === (S.draft != null ? S.draft : S.ceiling)) return; S.draft = v; refreshBands(); };
      const fromEvt = e => { const r = svg.getBoundingClientRect(); const vb = svg.viewBox.baseVal; const py = (e.clientY - r.top) / r.height * vb.height; return 400 - (py - y0) / (y1 - y0) * 120; };
      h.addEventListener('pointerdown', e => {
        e.preventDefault(); h.setPointerCapture(e.pointerId);
        const mv = ev => set(fromEvt(ev));
        const up = () => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); };
        h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up);
      });
      h.addEventListener('keydown', e => {
        const cur = S.draft != null ? S.draft : S.ceiling, step = e.shiftKey ? 5 : 1;
        if (e.key === 'ArrowUp') { set(cur + step); e.preventDefault(); }
        if (e.key === 'ArrowDown') { set(cur - step); e.preventDefault(); }
      });
    });
  }
  function refreshBands() {
    $$('[data-band]').forEach(w => {
      const id = w.dataset.band, focused = document.activeElement && document.activeElement.classList.contains('handle') && w.contains(document.activeElement);
      w.querySelector('.bandsvg').innerHTML = bandChart({ id, h: +w.dataset.h || 220, w: +w.dataset.w || 560 });
      const v = w.querySelector('.bandverdict'); if (v) { v.innerHTML = bandVerdict(); wireActs(v); }
      wireBand(w);
      if (focused) { const h = w.querySelector('.handle'); h && h.focus(); }
    });
    emit();
  }
  // Draw each band at its real width so its 12px labels stay 12px.
  function fitBands() {
    let changed = false;
    $$('[data-band]').forEach(w => { const cw = Math.round(w.clientWidth); if (cw > 0 && Math.abs(cw - (+w.dataset.w || 0)) > 3) { w.dataset.w = cw; changed = true; } });
    if (changed) refreshBands();
  }
  let fitT = 0; addEventListener('resize', () => { clearTimeout(fitT); fitT = setTimeout(fitBands, 120); });
  const band = (id, h, w) => `<div class="bandwrap" data-band="${id}" data-h="${h || 220}" data-w="${w || 560}"><div class="bandsvg">${bandChart({ id, h, w })}</div><div class="bandverdict">${bandVerdict()}</div></div>`;

  /* ---------------- module views ---------------- */
  const VIEWS = {};
  VIEWS.tables = () => {
    const d = byId('D-0193');
    const list = deals.filter(x => x.module === 'tables');
    const live = list.filter(x => !['done', 'off'].includes(STATE_CLASS[x.state])), closed = list.filter(x => ['done', 'off'].includes(STATE_CLASS[x.state]));
    const acts = `<button class="ui-btn sm" data-act="pair">Join with code</button><button class="ui-btn sm" data-act="house">Play the house seller</button><button class="ui-btn primary sm" data-act="pair">Open a table</button>`;
    return moduleHead('tables', acts)
      + (d.pending === 'countersign' ? decisionBar(d, `Countersign <b>$329.00</b> · Dan · north-desk · D-0193 · round 5 of 6`, `<button class="ui-btn sm" data-deal="D-0193">Open deal</button><button class="ui-btn danger sm" data-act="withdraw:D-0193">Withdraw</button>${privBtn('Review & countersign', 'decide:D-0193')}`) : '')
      + `<div class="cols"><div>${section('Live tables', live.length, group(live.map(row).join(''), 'No live tables. Play the house seller to try one.'))}
          ${section('Closed', closed.length, group(closed.map(row).join('')))}</div>
        <div>${section('D-0193 · the band', `${st(d.state)} <button class="ui-btn plain sm" data-pop="clauses" aria-label="Clauses">ⓘ</button>`, `<div class="ui-card">${band('tbl', 220)}</div>`)}
          <p class="ui-hint" style="margin:6px 4px 0">Signed offers only · drag the ceiling, the core enforces it, not the prompt.</p></div></div>`;
  };
  VIEWS.spend = () => {
    const list = deals.filter(x => x.module === 'spend');
    const dock = byId('D-0190'); const m = F.mandates[0];
    const clause = c => `<div class="ui-row two"><span class="clause">${c.n}</span><span class="main"><span class="t1">${esc(c.name)}</span><span class="t2" title="${esc(c.text)}">${esc(c.n === 4 ? c.text.replace('$340', '$' + S.ceiling) : c.text)}</span></span></div>`;
    return moduleHead('spend', `<button class="ui-btn sm" data-act="mandates">Mandate M-12 v${S.mandateV}</button>`)
      + (dock.state === 'AUTHORIZED' ? decisionBar(dock, `Capture or void <b>$64.00</b> · USB-C dock · dockparts.example · honor ${cd(at['D-0190'])}`,
        `<button class="ui-btn plain sm" data-pop="why:D-0190">Why?</button><button class="ui-btn danger sm" data-act="void:D-0190">Void</button>${privBtn('Review & capture', 'decide:D-0190')}`) : '')
      + `<div class="cols side"><div>${section('Requests, newest first', `${list.length} · ${list.filter(x => x.state === 'REFUSED').length} refused`, group(list.map(row).join('')))}</div>
        <div>${section(`The gate · M-12 v${S.mandateV}`, '<button class="ui-btn plain sm" data-pop="gate" aria-label="About the gate">ⓘ</button>', group(m.clauses.map(clause).join('')))}</div></div>`;
  };
  VIEWS.shield = () => {
    const list = deals.filter(x => x.module === 'shield');
    const hold = byId('D-0198');
    const rows = list.map(d => `<div class="ui-row two act ${d.pending ? 'need' : ''}" data-deal="${d.id}" tabindex="0" role="link"><span class="id">${d.id}</span>
        <span class="main"><span class="t1">${esc(cpName(d))} · ${esc(d.item)}</span><span class="t2">${esc((d.rules || [])[0] || d.sub)}${d.typology ? ' · typology ' + esc(d.typology) : ''}${d.mkt ? ' · ' + esc(d.mkt) + ' (skipped, not passed)' : ''}</span></span>
        ${d.note ? `<button class="ui-chip coral chipbtn" data-pop="note:${d.id}" title="Counterparty text, untrusted">note ›</button>` : ''}${amt(d)}${st(d.state)}<span class="chev"></span></div>`).join('')
      + `<div class="ui-row two act" data-deal="D-0193" tabindex="0" role="link"><span class="id">D-0193</span><span class="main"><span class="t1">Dan · north-desk · 27-inch 4K monitor</span><span class="t2">list $389 is 22% over the $318 median, under the 40% flag · payee matches the signed key</span></span><span class="amt proposed">$329.00</span>${st('CLEAR')}<span class="chev"></span></div>`;
    const checks = [['Payee ≠ signed deal payee', 'deterministic', 'BLOCK'], ['New counterparty, over $100', 'deterministic', 'ASK'], ['Over 1.4 × market median', 'Channel3 market reference', 'HOLD'], ['Scam typology in the text', 'quarantined engine, tool-less', 'HOLD'], ['“Pay as friends & family”', 'deterministic', 'BLOCK']];
    return moduleHead('shield')
      + (hold.state === 'HOLD' ? decisionBar(hold, `Release or keep hold <b>$140.00</b> · pixel-bay · new counterparty, first seen today`,
        `<button class="ui-chip coral chipbtn" data-pop="note:D-0198">note ›</button><button class="ui-btn sm" data-act="keephold">Leave it held</button>${privBtn('Release hold…', 'decide:D-0198')}`) : '')
      + `<div class="cols side"><div>${section('Holds and blocks, newest first', `${list.length + 1} checked`, group(rows))}
          <p class="ui-hint" style="margin:6px 4px 0">A BLOCK has no release button. No PayPal link was ever opened for one.</p></div>
        <div>${section('What the shield checks', '<button class="ui-btn plain sm" data-pop="shieldtext" aria-label="About the text check">ⓘ</button>',
          group(checks.map(([c, k, e]) => `<div class="ui-row two"><span class="main"><span class="t1">${esc(c)}</span><span class="t2">${esc(k)}</span></span>${st(e)}</div>`).join('')))}</div></div>`;
  };
  VIEWS.counter = () => {
    const q = byId('Q-0207');
    const orders = deals.filter(x => x.module === 'counter' && x.id !== 'Q-0207');
    const now = q.state === 'QUOTED'
      ? `<div class="ui-row two">${st('QUOTED')}<span class="main"><span class="t1">agent of wallet “lark” · Single monitor arm</span><span class="t2">list $64 · your floor <span class="teal">$58</span> · expires in ${cd(at['Q-0207'])}</span></span>
         <button class="ui-btn plain sm" data-pop="quote" aria-label="How a sale closes">ⓘ</button><span class="id">Q-0207</span><span class="amt proposed">${money(61)}</span></div>`
      : `<div class="ui-row two">${st(q.state)}<span class="main"><span class="t1">Nobody is at the counter right now</span><span class="t2">Q-0207 ${esc(q.sub || '')} · no money moved</span></span><span class="id">Q-0207</span>${amt(q)}</div>`;
    return moduleHead('counter', `<button class="ui-btn sm" data-act="feed">Export feed CSV</button><button class="ui-btn primary sm" data-act="savefloors">Sign floors · S-2</button>`)
      + `<div class="cols wide-r"><div>${section('At your counter now', '', group(now))}${section('Orders', orders.length, group(orders.map(row).join('')))}</div>
        <div>${section(`Catalog · ${F.shop.length} items`, 'prices and floors live locally <button class="ui-btn plain sm" data-pop="floors" aria-label="About floors">ⓘ</button>',
          `<div class="ui-group scroll" style="max-height:440px"><table class="ui-table"><thead><tr><th>Item</th><th class="num">List</th><th class="num">Floor</th><th class="num">Market</th><th>Feed</th></tr></thead><tbody>
          ${F.shop.map((it, i) => `<tr><td class="clip" title="${esc(it.title)} · ${esc(it.sku)} · ${esc(it.avail.replace('_', ' '))}">${esc(it.title)}</td><td class="num">${money0(it.price)}${it.sub ? '/mo' : ''}</td>
            <td class="num">${it.floor == null ? '<span class="dim">not haggled</span>' : `<input class="ui-field" type="number" min="1" step="1" value="${it.floor}" data-floor="${i}" aria-label="Floor for ${esc(it.title)}">`}</td>
            <td class="num">${it.mkt ? money0(it.mkt) : '<span class="dim">no ref</span>'}</td><td>${it.feedIssue ? `<span class="ui-chip red" title="${esc(it.feedIssue)}">missing field</span>` : '<span class="ui-chip ok">ok</span>'}</td></tr>`).join('')}
          </tbody></table></div>`)}</div></div>`;
  };
  VIEWS.rescue = () => {
    const subs = F.subscribers; const d = byId('D-0188');
    const sel = subs.find(s => s.id === S.rescueSel) || subs[0];
    const levers = [
      { k: 'DISCOUNT_THIS_CYCLE', t: 'Discount this cycle', d: 'one $9.60 invoice (−20%) for the missed cycle · paid → activate' },
      { k: 'PAUSE', t: 'Pause one cycle', d: 'suspend now, activate on 29 Nov · your own email explains' },
      { k: 'RETRY_AFTER_FIX', t: 'Retry after fix', d: 'capture the balance once they fix their funding source', dis: sel.replay ? 'disabled on replay rows (no real balance)' : sel.retryBlocked ? 'disabled: PayPal’s own retry is due within 24 h' : '' },
      { k: 'DOWNGRADE', t: 'Downgrade', d: 'revise to a pre-created cheaper plan', dis: 'off in rescue mandate R-3' }
    ];
    const live = sel.id === 'S-14';
    let panel;
    if (live && d.state === 'FAILED') {
      panel = group(levers.map(l => `<label class="ui-row two lever ${S.lever === l.k ? 'on' : ''} ${l.dis ? 'dis' : ''}"><input type="radio" name="lever" value="${l.k}" ${S.lever === l.k ? 'checked' : ''} ${l.dis ? 'disabled' : ''}>
          <span class="main"><span class="t1">${l.t} <span class="mono dim">${l.k}</span></span><span class="t2">${esc(l.dis || l.d)}</span></span></label>`).join(''))
        + `<div class="ui-group need-group" style="margin-top:var(--sp-3)"><div class="ui-row two"><span class="main"><span class="t1">${S.lever === 'PAUSE' ? 'Suspend one cycle' : 'Invoice <b>$9.60</b> · subscriber S-14'}</span>${silence(d.silence)}</span>
          <span class="acts"><button class="ui-btn sm" data-act="maildraft">Email draft ›</button>${privBtn('Review & approve lever', 'decide:D-0188')}</span></div></div>`;
    } else if (live && d.state === 'OFFER SENT') {
      panel = group(`<div class="ui-row two">${st('OFFER SENT')}<span class="main"><span class="t1">Invoice <span class="mono">INV2-8K4R-…</span> · ${money(9.6)} · sent by PayPal</span><span class="t2">recovered counts only when PayPal shows it PAID · replies are never read by an agent</span></span></div>`)
        + `<div class="ui-proto" style="margin-top:var(--sp-2)">In the app this arrives by polling the invoice. <button class="ui-btn sm" data-act="s14paid">Subscriber pays on PayPal</button></div>`;
    } else if (live && d.state === 'PAUSED') panel = group(`<div class="ui-row">${st('PAUSED')}<span class="clip">suspended until 29 Nov · nothing recovered, nothing charged</span></div>`);
    else if (live) panel = group(`<div class="ui-row">${st('RECOVERED')}<span class="clip">invoice PAID · ${money(9.6)} · subscription activated</span></div>`);
    else panel = group(`<div class="ui-row two">${st(sel.state)}<span class="main"><span class="t1">${esc(sel.retry)}</span><span class="t2">${sel.state === 'FAILED' ? 'rescue waits: PayPal retries this one itself within 24 h, so no offer before the retry result' : 'nothing to do'}</span></span></div>`);
    return moduleHead('rescue', `<div class="hstats"><div class="ui-stat" title="Counted from paid invoices and captures only"><span class="k">Recovered this month</span><span class="v ${S.recovered ? 'okc' : ''}">${money(S.recovered)}</span></div>
        <div class="ui-stat"><span class="k">Active care plans</span><span class="v">${F.activeSubscribers}</span></div><div class="ui-stat"><span class="k">Failing now</span><span class="v">${subs.filter(s => s.state === 'FAILED').length}</span></div></div>`)
      + `<div class="cols"><div>${section('Subscribers, by PayPal’s next retry', subs.length, `<div class="ui-group"><table class="ui-table"><thead><tr><th>Subscriber</th><th>State</th><th>PayPal</th></tr></thead><tbody>
          ${subs.map(s => `<tr class="click" data-sub="${s.id}" tabindex="0" aria-selected="${S.rescueSel === s.id}"><td><span class="mono">${s.id}</span> <span class="dim">since ${esc(s.since)}</span></td><td>${st(s.id === 'S-14' ? d.state : s.state)} ${replayBadge(s)}</td><td class="dim clip" title="${esc(s.retry)}">${esc(s.retry)}</td></tr>`).join('')}
        </tbody></table></div>`)}</div>
        <div>${section(`${sel.id} · ${esc(sel.plan)} ${replayBadge(sel)}`, sel.replay ? '<button class="ui-btn plain sm" data-pop="replay" aria-label="About replay">ⓘ</button>' : '', panel)}
          <p class="ui-hint" style="margin:6px 4px 0">Every lever acts on this one subscription. The plan-wide price change is never called.</p></div></div>`;
  };
  VIEWS.book = () => {
    const B = S.book;
    const presets = ['What did my agents commit this week, and how did it compare with the market?', 'Which deals are still pending in PayPal reporting?', 'What did the policy decide on its own?', 'Delete the GPU row'];
    const outlookHold = byId('D-0190').state === 'AUTHORIZED';
    const links = deals.filter(d => d.state === 'AWAITING BUYER APPROVAL' || d.state === 'AWAITING APPROVAL' || d.state === 'IN BROWSER').length;
    return moduleHead('book')
      + `<div class="ui-card"><form class="ask" data-form="ask"><input class="ui-field" name="q" value="${esc(B.q)}" placeholder="Ask about your agents’ money in plain words…" aria-label="Question"><button class="ui-btn primary" type="submit">Draft query</button></form>
        <div class="presets">${presets.map(p => `<button class="ui-btn sm" data-preset="${esc(p)}">${esc(p)}</button>`).join('')}</div>${bookBody()}</div>`
      + section('Cash-flow outlook', 'a fixed query, not an LLM one', `<div class="ui-card stats"><div class="ui-stat"><span class="k">Holds expiring</span><span class="v">${outlookHold ? '1' : '0'}</span><span class="ui-hint">${outlookHold ? `$64 dock · auto-void in ${cd(at['D-0190'])}` : 'none'}</span></div>
        <div class="ui-stat"><span class="k">Approve links open</span><span class="v">${links}</span><span class="ui-hint">nothing moves until approved on PayPal</span></div>
        <div class="ui-stat"><span class="k">Renewals due · 30 d</span><span class="v">${F.activeSubscribers}</span><span class="ui-hint">${money(F.activeSubscribers * 12)} expected · not yet billed</span></div></div>`);
  };
  function bookQuery(q) {
    const s = q.toLowerCase();
    if (/delete|drop|update|insert|pay |send|refund|remove/.test(s)) return { invalid: true, json: `{"view":"delete","filters":[{"field":"id","op":"eq","value":"D-0192"}]}`, err: 'schema rejected: /view must be one of ["deals","paypal_calls","receipts","subscriptions","reconciliation"] · the book is read-only' };
    if (/pending|reporting|reconcil|match/.test(s)) return { kind: 'rec', json: `{"view":"reconciliation","filters":[{"field":"state","op":"in","value":["CAPTURED","RECEIPTED"]}],"metrics":["count","sum_amount"],"range":{"from":"2026-10-26","to":"2026-11-01"}}` };
    if (/policy|decided|own|myself|automatic/.test(s)) return { kind: 'dec', json: `{"view":"deals","group_by":["decided_by"],"metrics":["count","sum_amount"],"range":{"from":"2026-10-26","to":"2026-11-01"}}` };
    return { kind: 'kind', json: `{"view":"deals","group_by":["kind"],"metrics":["count","sum_amount","avg_vs_market_pct"],"range":{"from":"2026-10-26","to":"2026-11-01"}}` };
  }
  function bookBody() {
    const B = S.book;
    if (B.phase === 'idle') return `<p class="ui-hint" style="margin:8px 0 0">Pick a question or type one. You see the exact query before anything runs.</p>`;
    if (B.phase === 'drafting') return `<p class="ui-hint" style="margin:8px 0 0">Drafting with ${esc(S.engine)} (tool-less profile)…</p>`;
    const r = B.result;
    if (r.invalid) return `<pre class="q bad">${esc(r.json)}</pre><div class="verdict no" style="margin-top:6px">INVALID · ${esc(r.err)}</div>`;
    let h = `<pre class="q">${esc(r.json)}</pre>`;
    if (B.phase === 'drafted') return h + `<div class="verdict draft" style="margin-top:6px">read-only connection · whitelisted view · bound parameters<span class="end"><button class="ui-btn primary sm" data-act="runq">Run read-only</button></span></div>`;
    const wk = deals.filter(d => ['Mon', 'Tue', 'Wed', 'Thu'].includes(d.day));
    const moved = d => ['CAPTURED', 'RECEIPTED', 'RECOVERED'].includes(d.state);
    if (r.kind === 'kind') {
      const groups = {};
      wk.forEach(d => { const k = d.kind.split(' · ')[0].replace('shop quote', 'shop order'); (groups[k] = groups[k] || []).push(d); });
      h += `<div class="ui-group" style="margin-top:8px"><table class="ui-table"><thead><tr><th>Kind</th><th class="num">Deals</th><th class="num">Captured</th><th class="num">Held</th><th class="num">Proposed</th><th class="num">Stopped</th><th class="num">vs market</th></tr></thead><tbody>${Object.entries(groups).map(([k, ds]) => {
        const sum = f => ds.filter(f).reduce((a, d) => a + (d.amount || 0), 0);
        const pcts = ds.filter(d => d.pct != null && moved(d)).map(d => d.pct);
        return `<tr><td>${esc(k)}</td><td class="num">${ds.length}</td><td class="num">${money(sum(moved))}</td><td class="num">${money(sum(d => d.state === 'AUTHORIZED'))}</td><td class="num dim">${money(sum(d => ['NEGOTIATING', 'QUOTED', 'AWAITING BUYER APPROVAL', 'AWAITING APPROVAL', 'FAILED', 'HOLD', 'AGREED', 'OFFER SENT'].includes(d.state)))}</td><td class="num">${ds.filter(d => d.state === 'REFUSED' || d.state === 'BLOCK').length}</td><td class="num">${pcts.length ? 'p' + Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : '—'}</td></tr>`;
      }).join('')}</tbody></table></div>`;
    }
    if (r.kind === 'dec') {
      const g = { 'policy · clause 6': wk.filter(d => d.decided === 'policy:clause6'), 'you': wk.filter(d => moved(d) && !d.decided || d.state === 'VOIDED'), 'refused by policy': wk.filter(d => d.state === 'REFUSED'), 'blocked by shield': wk.filter(d => d.state === 'BLOCK') };
      h += `<div class="ui-group" style="margin-top:8px"><table class="ui-table"><thead><tr><th>Decided by</th><th class="num">Deals</th><th class="num">Amount</th></tr></thead><tbody>${Object.entries(g).map(([k, ds]) => `<tr><td>${k}</td><td class="num">${ds.length}</td><td class="num">${money(ds.reduce((a, d) => a + (d.amount || 0), 0))}</td></tr>`).join('')}</tbody></table></div>`;
    }
    const recChip = d => d.rec === 'matched' ? '<span class="ui-chip ok">matched</span>' : d.rec === 'pending' || (moved(d) && d.rec !== 'matched') ? '<span class="ui-chip gold">pending in PayPal reporting</span>' : '<span class="ui-chip">n/a</span>';
    const rows = (r.kind === 'rec' ? deals.filter(moved) : wk).map(d => `<tr class="click" data-deal="${d.id}" tabindex="0"><td class="mono">${d.id}</td><td>${esc(d.kind)}</td><td class="clip">${esc(cpName(d))}</td><td class="num ${amtCls(d) === 'struck' ? 'dim' : ''}">${money(d.amount)}</td><td>${st(d.state)}</td><td>${recChip(d)}</td></tr>`).join('');
    h += section('Rows', `click one for its deal · <button class="ui-btn plain sm" data-act="csv">Export CSV</button>`, `<div class="ui-group scroll"><table class="ui-table"><thead><tr><th>Deal</th><th>Kind</th><th>Counterparty</th><th class="num">Amount</th><th>State</th><th>PayPal statement</th></tr></thead><tbody>${rows}</tbody></table></div>`);
    return h;
  }

  /* ---------------- deal view ---------------- */
  const STRIPS = {
    haggle: ['PAIRING', 'LISTED', 'NEGOTIATING', 'AGREED', 'SETTLING', 'AWAITING APPROVAL', 'APPROVED', 'SELLER-ATTESTED', 'RECEIPTED', 'RECONCILED'],
    purchase: ['PROPOSED', 'AWAITING APPROVAL', 'AUTHORIZED', 'CAPTURED'],
    shop: ['QUOTED', 'CHECKOUT', 'AWAITING BUYER APPROVAL', 'CAPTURED', 'TRACKED'],
    shield: ['PROPOSED', 'SHIELD', 'AWAITING APPROVAL', 'AUTHORIZED', 'CAPTURED'],
    rescue: ['FAILED', 'OFFER SENT', 'RECOVERED']
  };
  function stripFor(d) {
    const k = d.module === 'tables' ? 'haggle' : d.module === 'counter' ? 'shop' : d.module === 'rescue' ? 'rescue' : d.module === 'shield' ? 'shield' : 'purchase';
    const steps = STRIPS[k].slice(); let cur = d.state;
    if (cur === 'IN BROWSER') cur = 'AWAITING APPROVAL';
    if (k === 'shield' && (cur === 'HOLD' || cur === 'BLOCK')) cur = 'SHIELD';
    let idx = steps.indexOf(cur), term = null;
    if (idx < 0) {
      term = cur;
      const after = { REFUSED: 0, BLOCK: 1, WITHDRAWN: 2, VOIDED: 2, EXPIRED: 2, MISMATCH: 4, PAUSED: 0, LOST: 0 }[cur];
      idx = after == null ? 0 : after;
    }
    return `<div class="strip" aria-label="Deal states">${steps.map((s, i) => {
      const label = (k === 'shield' && s === 'SHIELD') ? (d.state === 'BLOCK' ? 'BLOCK' : d.state === 'HOLD' ? 'HOLD' : 'SHIELD ✓') : s;
      let cls = term ? (i < idx ? 'done' : '') : (i < idx ? 'done' : i === idx ? 'cur' + (STATE_CLASS[d.state] === 'done' ? ' ok' : '') : '');
      if (k === 'shield' && s === 'SHIELD' && d.state === 'BLOCK') cls = 'cur bad';
      return `<span class="${cls}">${label}</span>`;
    }).join('<i>›</i>')}${term ? `<i>›</i><span class="cur bad">${term}</span>` : ''}</div>`;
  }
  function timeline(d) {
    const li = (cls, s, t, when) => `<div class="ui-row ${cls}"><span class="id">${s}</span><span class="clip" style="flex:1">${t}</span><span class="when">${when}</span></div>`;
    if (d.id === 'D-0193') {
      const H = F.haggle;
      const items = H.envelopes.slice().reverse().map(e => li(e.by, '#' + e.seq, `${e.by === 'you' ? 'you' : 'Dan'} · ${e.typ} <b class="money">${money0(e.price)}</b>`, `✓ sig · ${e.t}`));
      const extra = { AGREED: ['ACCEPT ×2 · terms 51d0…', 'you countersigned (clause 6)'], SETTLING: ['SETTLE pending · Dan’s wallet creating the order'], 'AWAITING APPROVAL': ['SETTLE · order 7XK… · AUTHORIZE · $329.00 · attempt 1'], 'IN BROWSER': ['you opened PayPal in the browser'], APPROVED: ['APPROVED (polled GET /v2/checkout/orders/7XK…)'], 'SELLER-ATTESTED': ['Dan authorized + captured · seller-attested'], RECEIPTED: ['RECEIPT · capture 2JM… · head 7c1e…94 = ours'] };
      const order = ['AGREED', 'SETTLING', 'AWAITING APPROVAL', 'IN BROWSER', 'APPROVED', 'SELLER-ATTESTED', 'RECEIPTED'];
      const upto = order.indexOf(d.state === 'MISMATCH' ? 'AWAITING APPROVAL' : d.state);
      const sys = [];
      for (let i = 0; i <= upto; i++) (extra[order[i]] || []).forEach(t => sys.push(li('sys', '·', t, clock())));
      if (d.state === 'MISMATCH') sys.push(li('bad', '!', 'SETTLE says $339.00 ≠ signed $329.00 · HOLD', clock()));
      if (d.state === 'WITHDRAWN') sys.push(li('sys', '·', 'WITHDRAW{OWNER} signed · no money moved', clock()));
      return sys.reverse().join('') + items.join('');
    }
    const ev = F.audit.filter(a => a.deal === d.id).map(a => li('sys', a.seq, esc(a.action), esc(a.t)));
    const gen = [];
    gen.push(li('you', '·', `${esc((F.agents.find(a => a.id === d.agent) || {}).name || 'agent')} proposed ${d.amount != null ? money(d.amount) : esc(d.ask || '')}`, esc(d.when)));
    if (d.state === 'REFUSED') gen.unshift(li('bad', '✗', 'REFUSED by policy before any PayPal call', esc(d.when)));
    if (d.pp && d.pp.auth) gen.unshift(li('sys', '·', `authorized ${esc(d.pp.auth)} (hold)`, esc(d.when)));
    if (d.pp && d.pp.capture) gen.unshift(li('sys', '·', `captured ${esc(d.pp.capture)}${d.decided ? ' · by policy' : ''}`, esc(d.when)));
    if (d.state === 'VOIDED') gen.unshift(li('sys', '·', 'voided by you · hold released', esc(d.when)));
    return ev.join('') + gen.join('');
  }
  function dealView(d) {
    const m = MOD[d.module], cp = F.counterparties[d.cp] || { name: cpName(d), who: 'subscriber on your care plan · plain PayPal buyer, no wallet', key: '—', paired: 'n/a', firstSeen: '—' };
    const mk = F.market[d.ref];
    const isRefused = d.state === 'REFUSED';
    const pp = d.pp || {};
    const exportBtn = d.module === 'tables' || d.state === 'RECEIPTED' ? '<button class="ui-btn sm" data-act="export">Export transcript</button>' : '';
    const head = `<div class="ui-pagehead mhead" style="--mc:${m.color}"><span class="mico">${glyph(d.module)}</span><h1 tabindex="-1">${esc(d.item)}</h1>
      <span class="sub">${d.id} · ${esc(d.kind)} · ${esc(cpName(d))}</span><div class="actions">${exportBtn}<button class="ui-btn sm" data-mod="${d.module}">‹ ${m.name}</button></div></div>`;
    const key = `<div class="dealkey"><span class="dk-amt ${amtCls(d) === 'struck' ? 'struck' : ''}">${d.amount != null ? money(d.amount) : esc(d.ask || '—')}</span>${st(d.state)}${replayBadge(d)}<span class="badge sandbox">Sandbox</span>
      <span class="dk-money">Money now: <b class="${STATE_CLASS[d.state] === 'held' ? 'gold' : ''}">${esc(d.money)}</b></span></div>`;
    let decision = '';
    if (d.pending === 'countersign') decision = decisionBar(d, `Countersign <b>${money(d.amount)}</b> · round 5 of 6 · deadline 18:00 · ${cd(at[d.id], true)}`, `<button class="ui-btn danger sm" data-act="withdraw:${d.id}">Withdraw</button>${privBtn('Review & countersign', 'decide:' + d.id)}`);
    else if (d.pending === 'approve') decision = decisionBar(d, `Approve <b>${money(d.amount)}</b> on PayPal · window ${cd(d.approveUntil, true)}`, `<button class="ui-btn danger sm" data-act="withdraw:${d.id}">Withdraw</button>${privBtn('Review & approve', 'decide:' + d.id)}`);
    else if (d.pending === 'capture') decision = decisionBar(d, `Capture or void <b>${money(d.amount)}</b> · honor ${cd(at[d.id])}`, `<button class="ui-btn plain sm" data-pop="why:${d.id}">Why?</button><button class="ui-btn danger sm" data-act="void:${d.id}">Void</button>${privBtn('Review & capture', 'decide:' + d.id)}`);
    else if (d.pending === 'release') decision = decisionBar(d, `Release or keep hold <b>${money(d.amount)}</b> · ${esc(cp.name)}`, `<button class="ui-btn sm" data-act="keephold">Leave it held</button>${privBtn('Release hold…', 'decide:' + d.id)}`);
    else if (d.pending === 'lever') decision = decisionBar(d, `Approve a rescue lever · <b>${money(d.amount)}</b> offer ready`, `<button class="ui-btn gold" data-mod="rescue">Choose the lever in Rescue</button>`);
    else if (d.state === 'MISMATCH') decision = decisionBar(Object.assign({}, d, { silence: 'there is deliberately no “pay anyway” · no money moves' }), `SETTLE says <b>$339.00</b> ≠ signed $329.00`, `<button class="ui-btn danger sm" data-act="withdraw:${d.id}">Withdraw</button>`, 'bad');

    const showBand = d.id === 'D-0193' && ['NEGOTIATING', 'AGREED'].includes(d.state);
    const trace = isRefused ? section('Why the gate denied it', '<span class="ui-chip ok">0 PayPal calls</span>', group(
      `<div class="ui-row"><span class="ic okc">✓</span><span class="clause">1</span><span class="clip">roles · buy is allowed for the infra agent</span></div>
       <div class="ui-row fail"><span class="ic red">✗</span><span class="clause">3</span><span class="clip">per deal · quoted $11,960.00 &gt; max $200.00</span></div>
       <div class="ui-row fail"><span class="ic red">✗</span><span class="clause">3</span><span class="clip">category · “compute” is not in [office, parts, packing]</span></div>
       <div class="ui-row"><span class="ic dim">–</span><span class="clause">7</span><span class="clip dim">payee · not reached · gpu-cloud.example is not allowlisted either</span></div>`)
      + '<p class="ui-hint" style="margin:6px 4px 0">No order, no hold, nothing to undo. <button class="ui-btn plain sm" data-pop="request">The agent’s request ›</button></p>') : '';
    const tl = section(isRefused ? 'Audit' : 'Signed timeline', d.id === 'D-0193' ? '11 envelopes · hash-linked' : 'audit rows · hash-chained', `<div class="ui-group tl scroll">${timeline(d)}</div>`);
    const recChip = d.rec === 'matched' ? '<span class="ui-chip ok">matched</span>' : ['CAPTURED', 'RECEIPTED', 'SELLER-ATTESTED'].includes(d.state) ? '<span class="ui-chip gold">pending in PayPal reporting</span>' : '<span class="ui-chip">n/a</span>';
    const facts = `<div class="facts">
      ${section('<span class="teal">Your side</span> · Maya’s wallet', d.id === 'D-0193' ? '<button class="ui-btn plain sm" data-pop="clauses">clauses ›</button>' : '', `<div class="ui-card edge-you"><dl class="ui-kv">
        <dt>Agent</dt><dd>${esc((F.agents.find(a => a.id === d.agent) || {}).name || '—')} · <span class="mono">${esc(S.engine)}</span></dd>
        <dt>Mandate</dt><dd>${d.module === 'counter' ? 'S-2 v1 · shop floors' : d.module === 'rescue' ? 'R-3 v1 · rescue levers' : `M-12 v${S.mandateV} ✓`}</dd>
        ${d.id === 'D-0193' ? `<dt>Ceiling</dt><dd>${money(S.ceiling)} · 5 / 6 rounds</dd>` : ''}
        <dt>Decided by</dt><dd>${d.decided ? 'policy · clause 6' : d.pending ? '<span class="gold">you · pending</span>' : isRefused ? 'policy · refused' : 'you'}</dd></dl></div>`)}
      ${section(`<span class="coral">Their side</span> · ${esc(cp.name)}`, d.note ? `<button class="ui-chip coral chipbtn" data-pop="note:${d.id}">note ›</button>` : '', `<div class="ui-card edge-them"><dl class="ui-kv">
        <dt>Who</dt><dd>${esc(cp.who)}</dd><dt>Key</dt><dd class="mono">${esc(cp.key)}</dd><dt>Pairing</dt><dd>${esc(cp.paired)}</dd><dt>First seen</dt><dd>${esc(cp.firstSeen)}</dd>
        ${d.id === 'D-0193' ? '<dt>Their floor</dt><dd class="dim">hidden</dd>' : ''}<dt>Shield</dt><dd>${d.shield ? st(d.shield) : '<span class="dim">—</span>'}</dd></dl></div>`)}
      ${section('<span class="gold">PayPal</span>', d.route ? esc(d.route) : '', `<div class="ui-card edge-pp"><dl class="ui-kv">
        <dt>Order</dt><dd class="mono">${esc(pp.order || '—')}${pp.intent ? ' · ' + esc(pp.intent) : ''}</dd><dt>Auth</dt><dd class="mono">${esc(pp.auth || '—')}</dd><dt>Capture</dt><dd class="mono">${esc(pp.capture || '—')}</dd>
        ${d.approveUntil && ['AWAITING APPROVAL', 'IN BROWSER'].includes(d.state) ? `<dt>Approve window</dt><dd class="gold">${cd(d.approveUntil, true)}</dd>` : ''}
        <dt>Statement</dt><dd>${recChip}</dd></dl></div>`)}
      ${mk ? section('Market', `<button class="ui-btn plain sm" data-pop="market:${d.id}" aria-label="Market detail">ⓘ</button>`, `<div class="ui-card"><span class="money">p25 ${money0(mk.p25)} · median ${money0(mk.median)} · p75 ${money0(mk.p75)}</span>${d.amount ? `<div class="ui-hint">this deal: ${pctOf(d.amount, mk)}</div>` : ''}</div>`) : ''}
    </div>`;
    return head + key + decision + stripFor(d)
      + `<div class="cols side"><div>${showBand ? section('The band', 'drag the ceiling · the core enforces it, not the prompt', `<div class="ui-card">${band('deal', 200)}</div>`) : ''}${trace}${tl}</div>${facts}</div>`;
  }
  function pctOf(v, mk) {
    if (v <= mk.p25) return 'below p25'; if (v >= mk.p75) return 'above p75';
    const p = v <= mk.median ? 25 + (v - mk.p25) / (mk.median - mk.p25) * 25 : 50 + (v - mk.median) / (mk.p75 - mk.median) * 25;
    return 'p' + Math.round(p) + ' of the band';
  }

  /* ---------------- approval window ---------------- */
  let A = null; // {id, phase}
  function decide(id) {
    ensureDom();
    const d = byId(id); if (!d) return;
    A = { id, phase: S.locked ? 'LOCKED' : 'CHECKING', typed: '' };
    renderApproval();
    if (A.phase === 'CHECKING') setTimeout(() => { if (A && A.phase === 'CHECKING') { A.phase = 'READY'; renderApproval(); } }, reduce ? 50 : 650);
  }
  function closeApproval() { $('#approvalLayer').hidden = true; A = null; }
  const checkList = c => `<ul class="checks">${c.map(([ok, t]) => `<li class="${ok ? '' : 'x'}">${esc(t)}</li>`).join('')}</ul>`;
  const acts = (sil, buttons) => `<div class="acts">${silence(sil)}${buttons}</div>`;
  const more = (summaryText, paras) => `<details class="ui-disclosure"><summary>${summaryText}</summary>${paras.map(p => `<p>${p}</p>`).join('')}</details>`;
  const lockCard = sil => `<div class="notice locked line"><span class="n-code">Locked</span><span>Idle 17 min. Unlock with Windows Hello to continue; read-only views stay open.</span></div>`
    + more('Why it locks', ['PayPal requires re-authentication after 15 idle minutes; the wallet applies the same rule to countersign, approve, capture, release and sign.'])
    + acts(sil, '<button class="ui-btn gold locked" data-act="unlock">Unlock with Windows Hello</button>');
  const browserArt = () => `<svg viewBox="0 0 120 84" aria-label="Stylised system browser hand-off"><rect x="2" y="2" width="116" height="80" rx="7" style="fill:var(--bg);stroke:var(--line2)" stroke-width="2"/><rect x="2" y="2" width="116" height="15" rx="7" style="fill:var(--panel2)"/><circle cx="11" cy="9.5" r="2.5" style="fill:var(--line2)"/><circle cx="19" cy="9.5" r="2.5" style="fill:var(--line2)"/><rect x="28" y="6" width="80" height="7" rx="3.5" style="fill:var(--panel3)"/><text x="68" y="11.6" font-size="5.5" text-anchor="middle" style="fill:var(--muted);font-family:var(--mono)">sandbox.paypal.com</text><rect x="30" y="30" width="60" height="7" rx="3" style="fill:var(--panel3)"/><rect x="38" y="44" width="44" height="12" rx="6" fill="none" style="stroke:var(--gold)" stroke-dasharray="3 2"/><text x="60" y="73" font-size="6" text-anchor="middle" style="fill:var(--dim)">your browser · not this app</text><path d="M118 42h-8M110 42l4-4M110 42l4 4" style="stroke:var(--gold)" stroke-width="1.6" fill="none"/></svg>`;
  function renderApproval() {
    const L = $('#approvalLayer'); if (!A) return;
    const d = byId(A.id); L.hidden = false;
    const phases = ['CHECKING', 'READY', 'IN BROWSER', 'APPROVED (polled)', 'SELLER-ATTESTED', 'RECEIPTED'];
    let body = '', title = '', kicker = '', amount = money(d.amount), to = '';
    const mk = F.market[d.ref];
    const last = 329, ceil = S.ceiling, ready = A.phase === 'READY', locked = A.phase === 'LOCKED';
    const checking = A.phase === 'CHECKING' ? 'Checking…' : null;
    if (d.pending === 'countersign') {
      kicker = 'Countersign · clause 6'; title = 'Countersign this deal'; to = `with <b>Dan (north-desk)</b> for “${esc(d.item)}”`;
      const fits = last <= ceil;
      body = checkList([[fits, `inside mandate M-12 clause 4 (≤ ${money(ceil)})`], [true, 'round 5 of 6 · before 18:00'], [true, 'counterparty paired · words ✓'], [true, 'shield CLEAR'], [true, 'offer #11 carries Dan’s valid signature'], [true, 'delivery ShipThenCapture · 3 days']])
        + `<p class="line"><b>This does not pay anyone.</b> <span class="muted">It sends ACCEPT. You approve the payment later on PayPal’s own page.</span></p>`
        + more('Market and what happens next', [`vs market: ${money0(last)} is the ${pctOf(last, mk)} $${mk.p25}–$${mk.p75} · median $${mk.median}.`, 'Dan’s wallet then issues a PayPal order (AUTHORIZE). You approve it on PayPal’s own page in your browser; this window polls the order and never trusts the redirect.'])
        + (locked ? lockCard(d.silence) : acts(d.silence, `<button class="ui-btn danger" data-act="withdraw:${d.id}">Withdraw</button><button class="ui-btn primary" data-act="a-countersign" ${fits && ready ? '' : 'disabled'}>${checking || (fits ? 'Countersign ' + money(last) : 'Unsignable under this mandate')}</button>`));
    } else if (d.pending === 'capture') {
      kicker = 'Capture a held authorization'; title = 'Capture the held $64.00'; to = 'to <b>dockparts.example</b> · payee route · sandbox';
      body = checkList([[true, 'authorization 0RW7… is valid'], [true, 'amount = held amount $64.00'], [true, 'clause 3: under $200, category parts'], [true, 'clause 5: velocity 4/12 today'], [false, 'clause 7: payee not on allowlist · that is why this is yours'], [true, 'market: $64 is p40 of $58–$74']])
        + `<p class="line">Honor period left <b class="gold">${cd(at[d.id])}</b> · <span class="muted">capturing moves the money; voiding releases the hold.</span></p>`
        + (locked ? lockCard(d.silence) : acts(d.silence, `<button class="ui-btn danger" data-act="void:${d.id}">Void the hold</button><button class="ui-btn primary" data-act="a-capture" ${ready ? '' : 'disabled'}>${checking || 'Capture $64.00'}</button>`));
    } else if (d.pending === 'release') {
      kicker = 'Release a shield HOLD'; title = 'Release the hold on $140.00'; to = 'to <b>pixel-bay</b> · new counterparty, first seen today';
      const ok = A.typed.trim().toLowerCase() === 'pixel-bay';
      body = checkList([[false, 'new counterparty: first seen today, over $100'], [true, 'payee matches pixel-bay’s paired key'], [true, 'clause 3: under $200'], [false, 'no market reference · price rule skipped, not passed']])
        + `<div class="line">${quarantine('Untrusted · their note', d.note)}</div>
        <p class="line">Type the payee’s name to release: <b class="mono">pixel-bay</b></p><input class="ui-field" id="typeName" style="width:100%" value="${esc(A.typed)}" autocomplete="off" aria-label="Type pixel-bay to confirm">
        <p class="line"><b>Releasing does not pay.</b> <span class="muted">The purchase then waits for your approval on PayPal’s page.</span></p>`
        + (locked ? lockCard(d.silence) : acts(d.silence, `<button class="ui-btn" data-act="close">Keep it held</button><button class="ui-btn primary" data-act="a-release" ${ok && ready ? '' : 'disabled'}>${checking || 'Release hold'}</button>`));
    } else if (d.pending === 'lever') {
      const pause = S.lever === 'PAUSE';
      kicker = 'Approve a rescue lever'; title = pause ? 'Pause one cycle' : 'Discount this cycle'; to = 'for <b>subscriber S-14</b> · care plan $12/mo';
      amount = pause ? 'Pause · 1 cycle' : money(9.6);
      body = checkList([[true, 'one subscriber · S-14 only'], [true, `${S.lever} is on in rescue mandate R-3`], [true, pause ? 'pause ≤ 1 cycle' : 'discount −20% ≤ max −25%'], [true, 'no plan-wide price change'], [true, 'email from the fixed template, named slots only'], [true, 'replies are never read by an agent']])
        + `<p class="line"><b>${pause ? 'Nothing is charged.' : 'PayPal sends one $9.60 invoice.'}</b> <span class="muted">${pause ? 'The subscription is suspended until 29 Nov.' : 'Recovered counts only when PayPal shows it PAID.'}</span></p>`
        + (locked ? lockCard(d.silence) : acts(d.silence, `<button class="ui-btn" data-act="close">Not now</button><button class="ui-btn primary" data-act="a-lever" ${ready ? '' : 'disabled'}>${checking || (pause ? 'Suspend & open email' : 'Create $9.60 invoice & open email')}</button>`));
    } else if (d.pending === 'approve' || ['IN BROWSER', 'APPROVED', 'SELLER-ATTESTED', 'RECEIPTED', 'MISMATCH', 'AUTHORIZED'].includes(d.state)) {
      const isDan = d.id === 'D-0193';
      kicker = 'Approval window'; title = `Pay ${isDan ? 'Dan (north-desk)' : 'pixel-bay'}`; to = `for “${esc(d.item)}”`;
      if (d.state === 'MISMATCH') {
        kicker = 'MISMATCH · no PayPal button'; amount = money(329);
        body = `<div class="verdict no line">Dan’s SETTLE says <b>$339.00</b>, the signed deal says <b>$329.00</b>.</div><p class="line muted">There is deliberately no “pay anyway”. Shield verdict HOLD. The signed transcript is ready to export.</p>`
          + acts('no money moves', `<button class="ui-btn" data-act="export">Export transcript</button><button class="ui-btn danger" data-act="withdraw:${d.id}">Withdraw</button>`);
      } else if (d.state === 'AWAITING APPROVAL') {
        const checks = isDan ? [[true, 'amount = signed deal'], [true, 'invoice id 01JD…7Q-1'], [true, 'host www.sandbox.paypal.com'], [true, 'payee = paired key’s declared payee'], [true, 'shield CLEAR'], [S.ceiling >= 329, 'inside mandate M-12 clause 4']]
          : [[true, 'amount = request $140.00'], [true, 'issued by pixel-bay’s own shop (route ①)'], [true, 'host www.sandbox.paypal.com'], [true, 'shield hold released by you'], [true, 'clause 3: under $200'], [true, 'intent AUTHORIZE (held, then captured)']];
        const allOk = checks.every(c => c[0]);
        body = checkList(checks) + `<p class="line">Approve window <b class="gold">${cd(d.approveUntil, true)}</b>${isDan ? ` · <span class="muted">$329 is the ${pctOf(329, mk)} $301–$336</span>` : ''}</p>`
          + more('How approval works', ['Enabled only when every check is ✓. PayPal’s page opens in your system browser; it is never drawn inside this app.', 'The app then polls the order; it never trusts the redirect.'])
          + (locked ? lockCard('the order expires · no money moves') : acts('the order expires · no money moves', `<button class="ui-btn danger" data-act="withdraw:${d.id}">Withdraw</button><button class="ui-btn gold" data-act="a-browser" ${allOk && ready ? '' : 'disabled'}>${checking || 'Open PayPal in your browser ↗'}</button>`));
      } else if (d.state === 'IN BROWSER') {
        body = `<div class="handoff">${browserArt()}<div><b>Opened in your system browser.</b><p class="muted">Approve ${money(d.amount)} on PayPal’s own sandbox page there.</p>
          <p>Polling <span class="mono">GET /v2/checkout/orders/${isDan ? '7XK…' : '2PB…'}</span> every 5 s · window ${cd(d.approveUntil, true)}</p></div></div>` + acts('the order expires · no money moves', '<button class="ui-btn" data-act="close">Hide</button>');
      } else if (d.state === 'APPROVED') {
        body = `<div class="verdict ok line">${st('APPROVED')} PayPal reports the order approved (polled).</div><p class="line muted">${isDan ? 'Dan’s wallet now authorizes and captures; nothing is final until the signed receipt arrives.' : 'The authorization is next.'}</p>`;
      } else if (d.state === 'SELLER-ATTESTED') {
        body = `<div class="verdict draft line">${st('SELLER-ATTESTED')} Dan’s wallet says it captured · waiting for the signed RECEIPT to compare hashes…</div>`;
      } else if (d.state === 'RECEIPTED') {
        body = `<div class="verdict ok line">${st('RECEIPTED')} ${money(329)} captured by Dan · receipt signature verified</div>
          <div class="heads"><div class="ui-stat"><span class="k">Transcript head · your wallet</span><span class="mono teal">7c1e…94</span></div><span class="okc" style="font-size:var(--fs-title2)">=</span><div class="ui-stat"><span class="k">Transcript head · Dan’s wallet</span><span class="mono coral">7c1e…94</span></div></div>
          <p class="line ui-hint">PayPal statement: pending in PayPal reporting (Transaction Search lags up to 3 h).</p>` + acts('', '<button class="ui-btn" data-act="export">Export transcript</button><button class="ui-btn primary" data-act="close">Done</button>');
      } else if (d.state === 'AUTHORIZED') {
        body = `<div class="verdict ok line">${st('AUTHORIZED')} $140.00 is held at PayPal, not captured · capture follows on delivery</div>` + acts('', '<button class="ui-btn primary" data-act="close">Done</button>');
      }
    }
    const strip = d.pending === 'approve' || ['IN BROWSER', 'APPROVED', 'SELLER-ATTESTED', 'RECEIPTED'].includes(d.state) ? (() => {
      const map = { 'AWAITING APPROVAL': A.phase === 'CHECKING' ? 0 : 1, 'IN BROWSER': 2, APPROVED: 3, 'SELLER-ATTESTED': 4, RECEIPTED: 5 };
      const i = map[d.state] != null ? map[d.state] : 1;
      return `<div class="strip">${phases.map((p, j) => `<span class="${j < i ? 'done' : j === i ? 'cur' + (p === 'RECEIPTED' ? ' ok' : '') : ''}">${p === 'IN BROWSER' && j === i ? 'IN BROWSER · ' + dur(d.approveUntil - simNow(), true) : p}</span>`).join('<i>›</i>')}</div>`;
    })() : '';
    const proto = (d.id === 'D-0193' || d.id === 'D-0198') && ['AWAITING APPROVAL', 'IN BROWSER'].includes(d.state)
      ? `<div class="ui-proto">Sandbox simulation: ${d.state === 'IN BROWSER' ? '<button class="ui-btn sm" data-act="a-approved">PayPal page: approved</button><button class="ui-btn sm" data-act="a-closed">Browser closed, not approved</button>' : ''}${d.id === 'D-0193' ? '<button class="ui-btn sm" data-act="a-mismatch">Dan’s SETTLE says $339</button>' : ''}<button class="ui-btn sm" data-act="lock">${S.locked ? 'Unlock' : 'Idle 17 min'}</button></div>`
      : (ready || locked) && d.pending ? `<div class="ui-proto"><button class="ui-btn sm" data-act="lock">${S.locked ? 'Unlock' : 'Simulate idle 17 min'}</button></div>` : '';
    L.innerHTML = `<div class="awin" role="dialog" aria-modal="true" aria-labelledby="awBig"><div class="wbar"><svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="13" rx="10" ry="6" fill="none" style="stroke:var(--gold)" stroke-width="2"/><circle cx="12" cy="13" r="2" style="fill:var(--gold)"/></svg><span class="t"><b>Approval</b> · the only window that can release money</span><span class="badge sandbox">Sandbox</span><button class="ui-btn plain icon" data-act="close" aria-label="Close approval window">✕</button></div>
      <div class="wbody"><div class="kicker">${kicker}</div><div class="big" id="awBig" tabindex="-1">${amount}</div><div class="to">${title} ${to}</div>${strip}${body}${proto}</div></div>`;
    L.onclick = e => { if (e.target === L) closeApproval(); };
    wireActs(L);
    const tn = $('#typeName', L);
    if (tn) { tn.addEventListener('input', e => { A.typed = e.target.value; const b = $('[data-act="a-release"]', L); if (b) b.disabled = !(A.typed.trim().toLowerCase() === 'pixel-bay' && A.phase === 'READY'); }); setTimeout(() => tn.focus(), 30); }
    else setTimeout(() => { const h = $('#awBig', L); h && h.focus({ preventScroll: true }); }, 30); // never focus a money button: Enter must not release money
  }

  /* ---------------- actions ---------------- */
  function setState(id, patch) { Object.assign(byId(id), patch); }
  function after(ms, fn) { setTimeout(fn, reduce ? Math.min(ms, 300) : ms); }
  function act(a) {
    const [k, arg] = a.split(':');
    switch (k) {
      case 'home': return goHome();
      case 'find': return openPalette();
      case 'lock': S.locked = !S.locked; toast(S.locked ? '<b>Locked</b> after 15 idle minutes (simulated). Read-only views stay open.' : 'Unlocked with Windows Hello (simulated).', S.locked ? 'gold' : 'ok'); if (A) { A.phase = S.locked ? 'LOCKED' : 'READY'; renderApproval(); } rerender(); return;
      case 'unlock': S.locked = false; toast('Unlocked with Windows Hello (simulated).', 'ok'); if (A) { A.phase = 'READY'; renderApproval(); } rerender(); return;
      case 'decide': return decide(arg);
      case 'close': return closeApproval();
      case 'resetdraft': S.draft = null; refreshBands(); return;
      case 'keephold': toast('Left held. <b>Nothing is paid</b>; the request lapses at 20:00.'); return;
      case 'a-countersign': {
        setState('D-0193', { state: 'AGREED', pending: null, sub: 'ACCEPT ×2 · you countersigned', money: 'none — a signed deal is not a payment', silence: '' });
        toast('Countersigned. <b>No money moved.</b> Waiting for Dan’s wallet to issue the PayPal order.', 'ok');
        A.phase = 'WAIT'; renderApprovalWait('Dan’s wallet is creating the PayPal order (AUTHORIZE, $329.00)…');
        rerender();
        after(1500, () => { setState('D-0193', { state: 'SETTLING', sub: 'Dan’s wallet is creating the order' }); rerender(); });
        after(3000, () => {
          setState('D-0193', { state: 'AWAITING APPROVAL', pending: 'approve', approveUntil: simNow() + 6 * HOUR, sub: 'order 7XK… issued by Dan · approve in your browser', money: 'none — the order is not approved yet', silence: 'the order expires in 6 h · no money moves', pp: { order: '7XK2…9F', intent: 'AUTHORIZE', auth: null, capture: null } });
          rerender(); if (A && A.id === 'D-0193') { A.phase = 'CHECKING'; renderApproval(); after(650, () => { if (A && A.phase === 'CHECKING') { A.phase = 'READY'; renderApproval(); } }); }
        });
        return;
      }
      case 'a-browser': {
        const d = byId(A.id);
        setState(d.id, { state: 'IN BROWSER', sub: 'waiting for your approval on PayPal’s page' });
        toast('Opened <b>sandbox.paypal.com</b> in your system browser. This window keeps polling the order.', 'gold');
        renderApproval(); rerender(); return;
      }
      case 'a-closed': { const d = byId(A.id); setState(d.id, { state: 'AWAITING APPROVAL' }); toast('Browser closed without approving. The order is still CREATED. <b>No money moved.</b>'); A.phase = 'READY'; renderApproval(); rerender(); return; }
      case 'a-approved': {
        const d = byId(A.id);
        setState(d.id, { state: 'APPROVED', pending: null, sub: 'PayPal: APPROVED (polled)', money: 'approved, not yet captured', silence: '' });
        renderApproval(); rerender();
        if (d.id === 'D-0193') {
          after(1600, () => { setState('D-0193', { state: 'SELLER-ATTESTED', sub: 'Dan says captured · awaiting signed receipt', money: 'captured by Dan (seller-attested)', pp: { order: '7XK2…9F', intent: 'AUTHORIZE', auth: '1AU6…', capture: '2JM8…' } }); if (A) renderApproval(); rerender(); });
          after(3200, () => { setState('D-0193', { state: 'RECEIPTED', sub: 'receipt verified · transcript 7c1e…94 on both sides', money: '$329.00 paid to Dan · receipt verified', rec: 'pending', day: 'Thu', pct: 78 }); if (A) renderApproval(); rerender(); toast('Receipt verified · transcript head <b>7c1e…94</b> matches Dan’s.', 'ok'); });
        } else {
          after(1500, () => { setState(d.id, { state: 'AUTHORIZED', sub: 'held at PayPal · capture on delivery', money: 'held — authorized at PayPal, not captured', pp: { order: '2PB4…7H', intent: 'AUTHORIZE', auth: '6QT2…', capture: null } }); if (A) renderApproval(); rerender(); });
        }
        return;
      }
      case 'a-mismatch': setState('D-0193', { state: 'MISMATCH', pending: null, sub: 'SETTLE $339 ≠ signed $329 · no PayPal button', money: 'none — no PayPal button was offered', shield: 'HOLD' }); renderApproval(); rerender(); return;
      case 'a-capture': setState('D-0190', { state: 'CAPTURED', pending: null, sub: 'captured by you inside the honor period', money: 'captured — $64.00 paid to dockparts.example', silence: '', rec: 'pending', pp: Object.assign({}, byId('D-0190').pp, { capture: '3VE9…' }) }); toast('<b>Captured $64.00.</b> The hold became a payment.', 'ok'); closeApproval(); rerender(); return;
      case 'void': setState(arg, { state: 'VOIDED', pending: null, sub: 'voided by you · hold released', money: 'voided — nothing paid', silence: '' }); toast('Hold voided. <b>Nothing was paid.</b>', 'ok'); closeApproval(); rerender(); return;
      case 'a-release': setState('D-0198', { state: 'AWAITING APPROVAL', pending: 'approve', approveUntil: simNow() + 6 * HOUR, shield: 'CLEAR', sub: 'hold released by you · approve on PayPal', money: 'none — not approved yet', silence: 'the order expires in 6 h · no money moves', pp: { order: '2PB4…7H', intent: 'AUTHORIZE', auth: null, capture: null } }); toast('Hold released. <b>Nothing paid yet</b>; approval on PayPal is next.'); A.phase = 'CHECKING'; renderApproval(); after(650, () => { if (A) { A.phase = 'READY'; renderApproval(); } }); rerender(); return;
      case 'withdraw': setState(arg, { state: 'WITHDRAWN', pending: null, sub: 'withdrawn by you · signed WITHDRAW', money: 'none — no money moved', silence: '' }); toast('Withdrawn. <b>No money moved.</b>'); closeApproval(); rerender(); return;
      case 'export': toast('Signed transcript exported · <b>D-0193.table.jws</b> · carries the SANDBOX badge.'); return;
      case 'pair': return pairSheet(false);
      case 'house': return pairSheet(true);
      case 'mandates': return mandateSheet();
      case 'settings': return settingsSheet();
      case 'audit': return auditSheet();
      case 'maildraft': return mailSheet();
      case 'feed': toast('Feed written locally as <b>second-screen-feed.csv</b> (Store Sync field names). Not uploaded.'); return;
      case 'savefloors': {
        const bad = $$('[data-floor]').find(i => +i.value > F.shop[+i.dataset.floor].price || +i.value < 1);
        if (bad) { bad.style.borderColor = 'var(--refuse)'; bad.focus(); toast('A floor must be at least $1 and no higher than the list price.', 'bad'); return; }
        $$('[data-floor]').forEach(i => { F.shop[+i.dataset.floor].floor = +i.value; });
        toast('Shop mandate <b>S-2 v2</b> signed. The quoting agent can never go below these floors.', 'ok'); return;
      }
      case 'a-lever': {
        if (S.locked) { toast('Unlock first.', 'gold'); return; }
        if (S.lever === 'PAUSE') { setState('D-0188', { state: 'PAUSED', pending: null, amount: null, sub: 'suspended until 29 Nov', money: 'none — paused, nothing charged' }); toast('Subscription suspended for one cycle. Your email draft opened in your mail client.', 'ok'); }
        else { setState('D-0188', { state: 'OFFER SENT', pending: null, sub: 'invoice INV2-8K4R sent by PayPal · unpaid', money: 'invoice sent · unpaid — nothing recovered yet' }); toast('PayPal invoice <b>$9.60</b> created and sent. Draft opened in your mail client. Recovered stays $0.00 until PAID.', 'ok'); }
        closeApproval(); rerender(); return;
      }
      case 's14paid': setState('D-0188', { state: 'RECOVERED', sub: 'invoice PAID · subscription active', money: '$9.60 recovered · paid on PayPal', rec: 'pending', day: 'Thu' }); S.recovered = 9.6; toast('Invoice PAID (polled). <b>$9.60 recovered</b>, real sandbox money.', 'ok'); rerender(); return;
      case 'runq': S.book.phase = 'result'; rerender(); return;
      case 'csv': toast('book-2026-10-29.csv written · every row carries its SANDBOX badge.'); return;
    }
  }
  function renderApprovalWait(msg) {
    const L = $('#approvalLayer'); if (!L || L.hidden) return;
    const b = $('.wbody', L); if (b) b.insertAdjacentHTML('beforeend', `<div class="verdict draft line">◔ ${esc(msg)}</div>`);
    $$('.ui-btn.primary', L).forEach(x => { x.disabled = true; });
  }

  function wireActs(root) {
    $$('[data-act]', root).forEach(el => { if (el._w) return; el._w = 1; el.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); act(el.dataset.act); }); });
    $$('[data-pop]', root).forEach(el => { if (el._p) return; el._p = 1; el.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); showPop(el); }); });
  }
  function wire(root) {
    wireActs(root);
    $$('[data-mod]', root).forEach(el => el.addEventListener('click', e => { e.preventDefault(); open(el.dataset.mod); }));
    $$('[data-deal]', root).forEach(el => {
      el.addEventListener('click', e => { e.preventDefault(); openDeal(el.dataset.deal); });
      el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === el) { e.preventDefault(); openDeal(el.dataset.deal); } });
    });
    $$('[data-sub]', root).forEach(el => {
      const pick = () => { S.rescueSel = el.dataset.sub; S.lever = el.dataset.sub === 'S-22' ? 'PAUSE' : 'DISCOUNT_THIS_CYCLE'; rerender(); };
      el.addEventListener('click', pick); el.addEventListener('keydown', e => { if (e.key === 'Enter') pick(); });
    });
    $$('input[name="lever"]', root).forEach(el => el.addEventListener('change', () => { S.lever = el.value; rerender(); }));
    $$('[data-preset]', root).forEach(el => el.addEventListener('click', () => askBook(el.dataset.preset)));
    const f = $('[data-form="ask"]', root); if (f) f.addEventListener('submit', e => { e.preventDefault(); askBook(new FormData(f).get('q')); });
    wireBand(root);
  }
  function askBook(q) {
    q = String(q || '').trim(); if (!q) return;
    S.book = { phase: 'drafting', q, qid: S.book.qid + 1 }; rerender();
    const id = S.book.qid;
    after(700, () => { if (S.book.qid !== id) return; S.book.result = bookQuery(q); S.book.phase = S.book.result.invalid ? 'result' : 'drafted'; rerender(); });
  }

  /* ---------------- sheets (Layer 2, shared UI.sheet) ---------------- */
  function mandateSheet() {
    const m = F.mandates[0]; const draft = S.draft != null && S.draft !== S.ceiling ? S.draft : null;
    const body = `<p class="ui-hint" style="margin:0 0 8px">Your signed limit on what your agents may agree to. Agents can propose anything; the core signs only what fits.</p>
      <div class="ui-group">${m.clauses.map(c => `<div class="ui-row"><span class="clause">${c.n}</span><span style="width:130px;flex:none">${esc(c.name)}</span><span style="flex:1;min-width:0" class="muted">${esc(c.n === 4 ? c.text.replace('$340', '$' + (draft || S.ceiling)) : c.text)}${c.n === 4 && draft ? ` <span class="gold">(was $${S.ceiling})</span>` : ''}</span></div>`).join('')}</div>
      <dl class="ui-kv" style="margin-top:12px"><dt>Agent key</dt><dd class="mono">9f3c…a1</dd><dt>Commitment</dt><dd class="mono">${draft ? 'a7f2…09 (new)' : '51d0…e2'}</dd><dt>${draft ? 'Diff' : 'Signed'}</dt><dd>${draft ? `ceiling ${S.ceiling} → ${draft} vs v${S.mandateV}` : `${esc(m.signed)} · diff vs v2: ${esc(m.prev.diff)}`}</dd></dl>
      <div class="ui-section"><div class="ui-section-h"><h3>Other mandates</h3></div><div class="ui-group"><div class="ui-row"><span class="clause">S-2</span><span style="width:60px;flex:none">shop</span><span class="clip muted">${esc(F.mandates[1].text)}</span></div><div class="ui-row"><span class="clause">R-3</span><span style="width:60px;flex:none">rescue</span><span class="clip muted" title="${esc(F.mandates[2].text)}">${esc(F.mandates[2].text)}</span></div></div></div>
      <p class="ui-hint" style="margin:10px 0 0">Privileged and idle-locked. Each version is a new row; the counterparty only ever sees the commitment hash, never your ceiling.</p>`;
    const actions = [{ label: 'Revoke all', kind: 'danger', left: true, keep: true, onClick: () => toast('Revoking would stop every agent at once. (Not performed in this prototype.)', 'gold') }, { label: 'Close' }];
    if (draft) actions.push(S.locked ? { label: 'Unlock with Windows Hello', kind: 'gold', onClick: () => { act('unlock'); setTimeout(mandateSheet, 0); } }
      : { label: `Sign v${S.mandateV + 1} with owner key`, kind: 'primary', onClick: () => { S.ceiling = S.draft; S.draft = null; S.mandateV++; toast(`Mandate <b>M-12 v${S.mandateV}</b> signed · ceiling $${S.ceiling}.`, 'ok'); refreshBands(); rerender(); } });
    UI.sheet({ title: `Mandate M-12 · ${draft ? 'sign v' + (S.mandateV + 1) : 'v' + S.mandateV}`, body, actions, size: 'wide' });
  }
  function pairSheet(house) {
    if (house) {
      UI.sheet({ title: 'Play the house seller', size: 'narrow', body: `<div class="verdict draft">◔ The house seller is waking up (≈ 1 min) · D-0201 is pairing</div><p class="ui-hint" style="margin:8px 0 0">A scripted sandbox merchant, no LLM. Its key ships pinned in the release, so no words check is needed.</p>`, actions: [{ label: 'Close', kind: 'primary' }] });
      return;
    }
    const body = `<label class="ui-hint" for="pairCode">Code from the other owner</label><input class="ui-field" id="pairCode" style="width:100%;margin-top:4px" value="TBL-7Q4M-K2">
      <p style="margin:12px 0 0">Read these words to the other owner. Their screen must show the same four:</p><div class="words"><span>otter</span><span>basil</span><span>quartz</span><span>meadow</span></div>
      <p class="ui-hint" style="margin:0">This one click defeats a rendezvous sitting in the middle. The relay can delay envelopes, never forge them.</p>`;
    UI.sheet({ title: 'Pair a table', body, actions: [
      { label: 'They differ: abort', kind: 'danger', left: true, onClick: () => toast('Pairing aborted. Nothing was pinned.') },
      { label: 'Cancel' },
      S.locked ? { label: 'Unlock with Windows Hello', kind: 'gold', onClick: () => { act('unlock'); setTimeout(() => pairSheet(false), 0); } }
        : { label: 'Words match: pin key', kind: 'primary', onClick: () => toast('Key pinned. Your sourcing agent can now see this table.', 'ok') }] });
  }
  function settingsSheet() {
    const engines = ['claude-code', 'codex-cli', 'Scripted (no CLI installed)'];
    const body = `<div class="ui-section-h"><h3>Appearance</h3></div><div class="ui-group"><div class="ui-row"><span style="flex:1">Theme</span>${theme.seg()}</div></div>
      <div class="ui-section"><div class="ui-section-h"><h3>Engine</h3><span class="end">the wallet ships no model; it drives the CLI you have</span></div><div class="ui-group">
      ${engines.map(e => { const v = e.startsWith('Scripted') ? 'scripted' : e; return `<label class="ui-row two lever ${S.engine === v ? 'on' : ''}"><input type="radio" name="eng" value="${v}" ${S.engine === v ? 'checked' : ''}><span class="main"><span class="t1 mono">${esc(e)}</span><span class="t2">${e === 'claude-code' ? '$CLAUDE_CODE_BIN · found' : e === 'codex-cli' ? '$CODEX_CLI_BIN · found' : 'every agent card shows SCRIPTED ENGINE · no model'}</span></span></label>`; }).join('')}</div></div>
      <div class="ui-section"><div class="ui-section-h"><h3>PayPal</h3></div><div class="ui-group"><div class="ui-row two"><span class="main"><span class="t1">${esc(F.owner.paypal)}</span><span class="t2">credentials in the OS keychain, never shown again · approval always in your system browser</span></span></div></div></div>`;
    const sh = UI.sheet({ title: 'Settings', body, actions: [{ label: 'Done', kind: 'primary' }] });
    $$('input[name="eng"]', sh.el).forEach(r => r.addEventListener('change', () => {
      S.engine = r.value;
      $$('.lever', sh.el).forEach(l => l.classList.toggle('on', l.contains(r)));
      toast(S.engine === 'scripted' ? '<b>SCRIPTED ENGINE</b> · replayed turns, real wallet, real sandbox.' : `Engine set to <b>${esc(S.engine)}</b>.`);
      rerender();
    }));
  }
  function auditSheet() {
    const body = `<p class="ui-hint" style="margin:0 0 8px">Append-only, hash-chained. Rows can never be edited, not by you and not by an agent. Click a row for its deal.</p>
      <div class="ui-group"><table class="ui-table"><thead><tr><th>#</th><th>When</th><th>Actor</th><th>Action</th></tr></thead><tbody>${F.audit.map(a => `<tr class="click" data-audit="${a.deal}" tabindex="0"><td class="mono">${a.seq}</td><td class="dim">${esc(a.t)}</td><td class="mono">${esc(a.actor)}</td><td class="clip" title="${esc(a.action)}">${esc(a.action)}</td></tr>`).join('')}</tbody></table></div>
      <p class="ui-hint" style="margin:8px 0 0">ledger trust ✓ · head 3fa0…c7</p>`;
    const sh = UI.sheet({ title: 'Audit log', body, size: 'wide', actions: [{ label: 'Close', kind: 'primary' }] });
    $$('[data-audit]', sh.el).forEach(r => { const go = () => { sh.close(); openDeal(r.dataset.audit); }; r.addEventListener('click', go); r.addEventListener('keydown', e => { if (e.key === 'Enter') go(); }); });
  }
  function mailSheet() {
    const pause = S.lever === 'PAUSE';
    UI.sheet({ title: 'Email draft · S-14', size: 'narrow', body: `<p class="ui-hint" style="margin:0 0 8px">Fixed template, named slots only. It opens in your mail client; nothing is sent from the wallet.</p>
      <div class="mail">Hi <span class="slot">{first_name}</span>, your care-plan payment didn’t go through. ${pause ? 'We’ve paused your plan for one month; nothing to do, it restarts on <span class="slot">{29 Nov}</span>.' : 'Here is this month at <span class="slot">{$9.60}</span>; PayPal will email you the invoice.'}\n— Maya, Second Screen</div>`, actions: [{ label: 'Close', kind: 'primary' }] });
  }

  /* ---------------- find palette ---------------- */
  let palSel = 0;
  function palItems(q) {
    q = q.toLowerCase();
    const items = MODULES.map((m, i) => ({ t: `${m.name} · ${m.long}`, s: `module · ${i + 1}`, go: () => open(m.key) }))
      .concat(deals.map(d => ({ t: `${d.id} · ${d.item}`, s: `${cpName(d)} · ${d.state}`, go: () => openDeal(d.id) })))
      .concat(F.subscribers.map(s => ({ t: `${s.id} · ${s.plan}`, s: `subscriber · ${s.state}`, go: () => { S.rescueSel = s.id; open('rescue'); } })))
      .concat([{ t: 'Mandates · M-12', s: 'sheet', go: () => mandateSheet() }, { t: 'Settings', s: 'sheet', go: () => settingsSheet() }, { t: 'Audit log', s: 'sheet', go: () => auditSheet() }]);
    return q ? items.filter(i => (i.t + ' ' + i.s).toLowerCase().includes(q)) : items;
  }
  function openPalette() {
    ensureDom(); const P = $('#palette'); P.hidden = false; const inp = $('#palIn'); inp.value = ''; palSel = 0; drawPal(); inp.focus();
    inp.oninput = () => { palSel = 0; drawPal(); };
    inp.onkeydown = e => {
      const n = palItems(inp.value).length;
      if (e.key === 'ArrowDown') { palSel = Math.min(n - 1, palSel + 1); drawPal(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { palSel = Math.max(0, palSel - 1); drawPal(); e.preventDefault(); }
      if (e.key === 'Enter') { const it = palItems(inp.value)[palSel]; if (it) { closePalette(); it.go(); } }
    };
    P.onclick = e => { if (e.target === P) closePalette(); };
  }
  function drawPal() {
    const its = palItems($('#palIn').value).slice(0, 40);
    $('#palList').innerHTML = its.map((i, k) => `<li class="${k === palSel ? 'on' : ''}" data-k="${k}">${esc(i.t)}<small>${esc(i.s)}</small></li>`).join('') || '<li class="dim">Nothing matches.</li>';
    $$('#palList li[data-k]').forEach(li => { li.onclick = () => { const it = its[+li.dataset.k]; closePalette(); it.go(); }; });
    const on = $('#palList li.on'); if (on) on.scrollIntoView({ block: 'nearest' });
  }
  function closePalette() { $('#palette').hidden = true; }

  /* ---------------- global keys + ticker ---------------- */
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
    if (e.key === 'Escape') { // UI.js closes a sheet or popover first (capture phase)
      if ($('#palette') && !$('#palette').hidden) { closePalette(); return; }
      if (S.level === 0 && !A) { if (cfg.onEscHome) cfg.onEscHome(); return; }
      back(); return;
    }
    const tag = (e.target.tagName || '').toLowerCase(); if (tag === 'input' || tag === 'textarea') return;
    if (UI.open || e.ctrlKey || e.metaKey || e.altKey) return;
    if (S.level > 0 && /^[1-6]$/.test(e.key) && $('#approvalLayer').hidden && $('#palette').hidden) open(MODULES[+e.key - 1].key);
  });
  setInterval(() => {
    $$('.cd').forEach(el => { el.textContent = dur(+el.dataset.until - simNow(), el.dataset.long === '1'); });
    const q = byId('Q-0207');
    if (q.state === 'QUOTED' && simNow() > at['Q-0207']) { setState('Q-0207', { state: 'EXPIRED', sub: 'quote expired at 14:12 · lark did not check out', money: 'none — no order was created' }); if (S.module === 'counter') rerender(); else emit(); }
  }, 1000);
  const st0 = document.createElement('style'); st0.textContent = '@keyframes pulse{0%,100%{stroke-opacity:1}50%{stroke-opacity:.35}}'; document.head.appendChild(st0);

  const SHEETS = { settings: settingsSheet, mandates: mandateSheet, audit: auditSheet, pair: () => pairSheet(false), house: () => pairSheet(true) };
  window.App = {
    MODULES, MOD, glyph, money, money0, dur, cd, esc, simNow, clock, at, theme,
    chip: st, chipCls, silence, lockSvg, STATE_CLASS,
    init(c) {
      cfg = c || {}; ensureDom(); emit();
      // deep links (also used by the Tumbler's "Open in Table"): #m=spend · #d=D-0193 · #a=D-0193 (approval window) · #s=settings|mandates|audit|pair|house
      const h = location.hash.match(/^#([mdas])=([\w-]+)/);
      if (h) setTimeout(() => {
        if (h[1] === 'm' && MOD[h[2]]) open(h[2]);
        else if (h[1] === 'd' && byId(h[2])) openDeal(h[2]);
        else if (h[1] === 'a' && byId(h[2])) { openDeal(h[2]); decide(h[2]); }
        else if (h[1] === 's' && SHEETS[h[2]]) SHEETS[h[2]]();
      }, 60);
    },
    on(fn) { S.listeners.push(fn); },
    summary, open, openDeal, decide, goHome, openPalette,
    deal: byId, deals: () => deals, state: S, band, wireBand: root => { wireBand(root); wireActs(root); }, refreshBands, toast,
    act: (a) => act(a), get overlay() { return !!(UI.open || ($('#approvalLayer') && !$('#approvalLayer').hidden) || ($('#palette') && !$('#palette').hidden)); }
  };
})();
