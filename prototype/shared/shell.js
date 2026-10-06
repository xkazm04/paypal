// Shared prototype bar for the page prototypes: links every page (grouped by window), switches
// variants, and says the data is the illustrative sandbox week. Not part of the product. Usage,
// at the end of <body>, after ../../../main/fixtures.js:
//   <script src="../../../shared/shell.js" data-page="tables" data-variant="2"></script>
// A page outside pages/<page>/variant-n/ passes data-root, e.g. prototype/tumbler: data-root="../".
(function () {
  const me = document.currentScript;
  const page = me.dataset.page;
  const variant = me.dataset.variant || '1';
  // Path from this page to prototype/ (pages under pages/<page>/variant-n/ need the default).
  const root = me.dataset.root || '../../../';
  // [slug, label, window]. Home and Tumbler v1 live outside prototype/pages (see index.html).
  const PAGES = [
    ['home', 'Home', 'main'], ['tables', 'Tables', 'main'], ['spend', 'Spend', 'main'],
    ['shield', 'Shield', 'main'], ['counter', 'Counter', 'main'], ['rescue', 'Rescue', 'main'],
    ['book', 'Book', 'main'], ['deal', 'Deal', 'main'], ['setup', 'Setup', 'main'],
    ['tumbler', 'Tumbler', 'tumbler'],
    ['approval', 'Approval', 'approval'], ['mandate', 'Mandate', 'approval'], ['pairing', 'Pairing', 'approval'],
  ];
  // Owner verdict 2026-10-06: page links open the chosen variant; v1-v3 stay reachable on each page.
  // Home is the Dial (decided 2 Oct).
  const CHOSEN = { tables: 3, spend: 2, shield: 2, counter: 1, rescue: 3, book: 1, deal: 1, setup: 2, tumbler: 1, approval: 3, mandate: 3, pairing: 1 };
  const href = (slug, v) => {
    if (slug === 'home') return `${root}index.html#home`;
    if (slug === 'tumbler' && String(v) === '1') return `${root}tumbler/index.html`;
    return `${root}pages/${slug}/variant-${v}/index.html`;
  };
  const css = `
  .tshell{position:sticky;top:0;z-index:9000;display:flex;align-items:center;gap:14px;height:var(--shell-h,40px);padding:0 16px;
    background:color-mix(in srgb,var(--bg) 86%,transparent);backdrop-filter:blur(12px);border-bottom:1px solid var(--line);
    font:500 13px/1 var(--font);color:var(--muted);white-space:nowrap;overflow:hidden}
  .tshell b{font:700 14px/1 var(--display);color:var(--text);letter-spacing:.01em}
  .tshell nav{display:flex;align-items:center;gap:1px;min-width:0;flex:1 1 auto;overflow-x:auto;scrollbar-width:none}
  .tshell nav::-webkit-scrollbar{display:none}
  .tshell nav i{width:1px;height:16px;background:var(--line2);margin:0 6px;flex:none}
  .tshell nav small{font:600 11px/1 var(--mono);color:var(--dim);letter-spacing:.08em;text-transform:uppercase;margin-right:4px}
  .tshell a{color:var(--dim);text-decoration:none;padding:6px 8px;border-radius:6px}
  .tshell a:hover{color:var(--text);background:var(--panel2)}
  .tshell a[aria-current]{color:var(--text);background:var(--panel2);box-shadow:inset 0 0 0 1px var(--line2)}
  .tshell .meta{margin-left:auto;flex:none;display:flex;gap:12px;align-items:center;font:500 12px/1 var(--mono);color:var(--dim)}
  .tshell .vs a{padding:5px 7px;font-family:var(--mono)}
  .tshell .sb{color:var(--on-gold);background:var(--gold);padding:3px 6px;border-radius:4px;font-weight:700;letter-spacing:.06em}
  @media (max-width:1360px){.tshell nav small,.tshell .meta .note{display:none}.tshell a{padding:6px 6px}}
  @media (max-width:1100px){.tshell>b,.tshell .sb{display:none}.tshell{gap:8px;padding:0 8px}}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const bar = document.createElement('header'); bar.className = 'tshell'; bar.setAttribute('data-prototype-chrome', '');
  let last = '';
  const links = PAGES.map(([slug, label, win]) => {
    const sep = win !== last ? `${last ? '<i></i>' : ''}<small>${win}</small>` : '';
    last = win;
    return `${sep}<a href="${href(slug, CHOSEN[slug] || 1)}"${slug === page ? ' aria-current="page"' : ''}>${label}</a>`;
  }).join('');
  const vs = page === 'home' ? '' : [1, 2, 3].map((v) => `<a href="${href(page, v)}"${String(v) === variant ? ' aria-current="page"' : ''}>v${v}${CHOSEN[page] === v ? '★' : ''}</a>`).join('');
  bar.innerHTML = `<b>The Table</b><nav aria-label="Pages">${links}</nav>
    <div class="meta"><span class="vs" aria-label="Variants">${vs}</span><span class="sb">SANDBOX</span>
    <span class="note">illustrative week · prototype</span><a href="${root}index.html">all prototypes</a></div>`;
  document.body.prepend(bar);
  // Keep the current page visible when the links overflow (scrollLeft, so no ancestor frame scrolls).
  const nav = bar.querySelector('nav'), cur = nav.querySelector('[aria-current]');
  const x = cur ? cur.offsetLeft - nav.offsetLeft : 0;
  if (cur && x + cur.offsetWidth > nav.clientWidth) nav.scrollLeft = x - nav.clientWidth / 2;
})();
