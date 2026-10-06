// The Table UI baseline v2: layer-2 behaviour for page prototypes (sheet, popover, inspector,
// toast) plus a text escaper. Load after tokens.css + ui.css, before the page's own script.
//
//   UI.sheet({ title, body, actions, size })  -> { el, close }   body: HTML string or Node
//       actions: [{ label, kind: 'primary'|'gold'|'danger'|'plain', onClick(close), keep, left }]
//   UI.popover(anchorEl, body, { title })      -> { el, close }   closes on outside click / Esc
//   UI.inspector(splitEl, open?)               toggles .has-insp on a .ui-split
//   UI.toast(message, kind)                    kind: 'ok' | 'bad' | 'gold' | undefined
//   UI.esc(text)                               escape untrusted text before it reaches innerHTML
//
// Declarative: <button data-sheet="tpl-id"> opens <template id="tpl-id" data-title="…"> as a
// sheet; <button data-popover="tpl-id"> opens it as a popover. Esc closes the topmost layer.
// Sheets focus their heading, never a money button, so Enter cannot release money.
(function () {
  const stack = [];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fill = (host, body) => { if (body instanceof Node) host.appendChild(body); else host.innerHTML = body ?? ''; };

  function sheet({ title = '', body = '', actions = [{ label: 'Done', kind: 'primary' }], size = '' } = {}) {
    const back = document.activeElement;
    const scrim = document.createElement('div'); scrim.className = 'ui-scrim';
    const el = document.createElement('section');
    el.className = `ui-sheet ${size}`; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.innerHTML = `<header class="ui-sheet-h"><h2 tabindex="-1"></h2><button class="ui-btn plain icon x" aria-label="Close">✕</button></header>
      <div class="ui-sheet-b"></div>${actions.length ? '<footer class="ui-sheet-f"></footer>' : ''}`;
    el.querySelector('h2').textContent = title;
    fill(el.querySelector('.ui-sheet-b'), body);
    const close = () => {
      const i = stack.indexOf(api); if (i >= 0) stack.splice(i, 1);
      scrim.remove(); el.remove(); if (back && back.focus) back.focus();
    };
    const foot = el.querySelector('.ui-sheet-f');
    actions.forEach((a) => {
      const b = document.createElement('button');
      b.className = `ui-btn ${a.kind || ''} ${a.left ? 'left' : ''}`; b.textContent = a.label;
      if (a.disabled) b.disabled = true;
      b.addEventListener('click', () => { const r = a.onClick ? a.onClick(close, el) : undefined; if (!a.keep && r !== false) close(); });
      foot.appendChild(b);
    });
    el.querySelector('.x').addEventListener('click', close);
    scrim.addEventListener('click', close);
    document.body.append(scrim, el);
    el.querySelector('h2').focus();
    const api = { el, close, kind: 'sheet' }; stack.push(api);
    return api;
  }

  function popover(anchor, body, { title = '' } = {}) {
    const el = document.createElement('div'); el.className = 'ui-popover'; el.setAttribute('role', 'dialog');
    el.innerHTML = title ? `<h3></h3><div></div>` : '<div></div>';
    if (title) el.querySelector('h3').textContent = title;
    fill(el.lastElementChild, body);
    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
    let x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
    let y = r.bottom + 6; if (y + h > innerHeight - 8) y = Math.max(8, r.top - h - 6);
    el.style.left = `${x}px`; el.style.top = `${y}px`;
    const close = () => { const i = stack.indexOf(api); if (i >= 0) stack.splice(i, 1); el.remove(); document.removeEventListener('pointerdown', out, true); };
    const out = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); };
    setTimeout(() => document.addEventListener('pointerdown', out, true));
    const api = { el, close, kind: 'popover' }; stack.push(api);
    return api;
  }

  function inspector(split, open) {
    const on = open ?? !split.classList.contains('has-insp');
    split.classList.toggle('has-insp', on);
    const insp = split.querySelector('.ui-inspector'); if (insp) insp.hidden = !on;
    return on;
  }

  let toastTimer;
  function toast(msg, kind) {
    document.querySelectorAll('.ui-toast').forEach((t) => t.remove());
    const t = document.createElement('div'); t.className = `ui-toast ${kind || ''}`; t.setAttribute('role', 'status');
    fill(t, msg instanceof Node ? msg : esc(msg)); document.body.appendChild(t);
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 3200);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stack.length) { e.preventDefault(); e.stopImmediatePropagation(); stack[stack.length - 1].close(); }
  }, true);
  document.addEventListener('click', (e) => {
    const s = e.target.closest('[data-sheet]'), p = e.target.closest('[data-popover]');
    const t = s || p; if (!t) return;
    const tpl = document.getElementById(t.dataset.sheet || t.dataset.popover); if (!tpl) return;
    const body = tpl.content.cloneNode(true);
    if (s) sheet({ title: tpl.dataset.title || '', body, size: tpl.dataset.size || '' });
    else popover(t, body, { title: tpl.dataset.title || '' });
  });

  window.UI = { sheet, popover, inspector, toast, esc, get open() { return stack.length; } };
})();
