// Regenerates prototype/index.html: the verdict report for the page prototypes. One section per
// page (grouped by window), one card per variant with its name and bet read from NOTES.md, a live
// preview, and a pick + note that the owner can copy back as a verdict.
//   node prototype/build-index.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CONTEST = '../.contest/arena/agentic-wallet-ui/entries/claude-claude-opus-5-5_high-table';

// [slug, title, window, question, decided?]
const PAGES = [
  ['home', 'Home · The Table (level 0)', 'main', 'What needs me, what is moving, and where do I go next?', 3],
  ['tables', 'Tables · haggle (Mon)', 'main', 'Which tables are live, how close is each to my band, and where do I set the band?'],
  ['spend', 'Spend · firewall (Tue)', 'main', 'What did my agents ask to buy, what was stopped and why, and which hold is waiting on me?'],
  ['shield', 'Shield · scam shield (Wed)', 'main', 'Who was stopped before any money moved, on what evidence, and which hold may I release?'],
  ['counter', 'Counter · agent-ready shop (Thu)', 'main', 'Who is at my counter right now, and are my floors right?'],
  ['rescue', 'Rescue · subscription rescue (Fri)', 'main', 'Which subscribers’ renewals are failing, and which one lever do I approve for each?'],
  ['book', 'Book · ops cockpit (Sun)', 'main', 'What did my agents commit this week, how did it compare with the market, and does PayPal agree yet?'],
  ['deal', 'Deal detail (level 2)', 'main', 'What exactly happened in this deal, and why may I believe it?'],
  ['setup', 'Setup · first run and settings', 'main', 'What must be true before my agents can touch money, and what can only I set?'],
  ['tumbler', 'The Tumbler', 'tumbler', 'Does anything need me right now, how loudly, and what can I do without opening The Table?'],
  ['approval', 'Approval · the money moment', 'approval', 'Is this exactly what I signed, and do I let it go out?'],
  ['mandate', 'Mandate · sign and revoke', 'approval', 'What am I allowing my agents to do, and what changes if I sign this version?'],
  ['pairing', 'Pairing · pair a table', 'approval', 'Is the wallet across the table really who I think it is?'],
];
// Owner verdict 2026-10-06 (Home decided 2 Oct; Deal v1 picked the same day).
const CHOSEN = { home: 3, deal: 1, tables: 3, spend: 2, shield: 2, counter: 1, rescue: 3, book: 1, setup: 2, tumbler: 1, approval: 3, mandate: 3, pairing: 1 };
const VERDICT_NOTE = { approval: 'window and its sheets 20% wider (620 → 744 px)' };
const WINDOWS = { main: 'Main window', tumbler: 'Tumbler window', approval: 'Approval window' };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function notes(file) {
  if (!fs.existsSync(file)) return { name: '(no notes)', bet: '' };
  const t = fs.readFileSync(file, 'utf8');
  const name = (t.match(/^#\s+(.+)$/m) || [, '(untitled)'])[1].trim();
  const section = (h) => ((t.split(new RegExp(`^##\\s+${h}\\s*$`, 'm'))[1] || '').split(/^##\s/m)[0] || '').trim();
  let bet = section('The bet') || section('Philosophy') || (t.split(/^#\s.+$/m)[1] || '').split(/^##\s/m)[0].trim();
  bet = bet.replace(/[*`_]/g, '').replace(/\s+/g, ' ');
  return { name, bet: bet.length > 300 ? bet.slice(0, 297) + '…' : bet };
}

// Where each variant lives (relative to prototype/), and where its NOTES.md is.
function variant(slug, n) {
  if (slug === 'home') {
    if (n === 3) return { href: 'main/index.html', notes: 'main/NOTES.md', origin: 'UI contest A/3 · carried into prototype/main' };
    return { href: `${CONTEST}/variant-${n}/index.html`, notes: `${CONTEST}/variant-${n}/NOTES.md`, origin: `UI contest A/${n} · local only (.contest is git-ignored)` };
  }
  if (slug === 'tumbler' && n === 1) return { href: 'tumbler/index.html', notes: 'tumbler/NOTES.md', origin: 'existing prototype/tumbler' };
  return { href: `pages/${slug}/variant-${n}/index.html`, notes: `pages/${slug}/variant-${n}/NOTES.md`, origin: 'new · 2026-10-06' };
}

let lastWin = '';
let built = 0, missing = 0;
const sections = PAGES.map(([slug, title, win, q, decided], i) => {
  const head = win !== lastWin ? `<h2 class="win" id="w-${win}">${WINDOWS[win]}</h2>` : '';
  lastWin = win;
  const cards = [1, 2, 3].map((n) => {
    const v = variant(slug, n);
    const exists = fs.existsSync(path.join(here, v.href));
    if (!exists) { missing++; return `<div class="card missing"><div class="ph">not built yet</div><div class="body"><b>v${n}</b></div></div>`; }
    built++;
    const { name, bet } = notes(path.join(here, v.notes));
    const chosen = CHOSEN[slug] === n;
    return `<article class="card${chosen ? ' decided' : ''}" data-page="${slug}" data-v="${n}" data-name="${esc(name)}">
      <a class="ph" href="${esc(v.href)}" tabindex="-1" aria-hidden="true"><iframe data-src="${esc(v.href)}" title="" loading="lazy" tabindex="-1"></iframe></a>
      <div class="body"><a class="title" href="${esc(v.href)}">v${n} · ${esc(name)}</a>${chosen ? `<span class="ui-chip ok tag">★ chosen ${slug === 'home' ? '2 Oct' : '6 Oct'}</span>` : ''}
      <p>${esc(bet)}</p><div class="foot"><span class="origin">${esc(v.origin)}</span>
      <label class="pick"><input type="radio" name="pick-${slug}" value="${n}"> pick</label></div></div></article>`;
  }).join('');
  return `${head}<section id="${slug}"><div class="sh"><h3><span class="num">${String(i + 1).padStart(2, '0')}</span>${esc(title)}</h3>
    <p class="q">${esc(q)}</p>${VERDICT_NOTE[slug] ? `<span class="ui-chip ${slug === 'deal' ? 'gold' : 'line'}">${esc(VERDICT_NOTE[slug])}</span>` : ''}</div><div class="cards">${cards}</div>
    <textarea data-page="${slug}" rows="1" class="ui-field note" placeholder="Note for ${esc(title.split(' ·')[0])}: fuse parts, fix, reject…"></textarea></section>`;
}).join('\n');

const toc = PAGES.map(([slug, title]) => `<a href="#${slug}">${esc(title.split(' ·')[0].split(' (')[0])}</a>`).join('');

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>The Table · page prototypes</title><link rel="stylesheet" href="shared/tokens.css"><link rel="stylesheet" href="shared/ui.css">
<style>
main{max-width:1440px;margin:0 auto;padding:var(--sp-6) var(--sp-5) 96px}
h1{font:var(--fw-bold) var(--fs-title1)/1.2 var(--display);margin:0}
.lede{color:var(--muted);max-width:880px;margin:var(--sp-1) 0 var(--sp-3)}
.toc{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;align-items:center;gap:2px;padding:6px 0;background:var(--material);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
.toc a{color:var(--dim);text-decoration:none;padding:3px 8px;border-radius:var(--r-sm)}.toc a:hover{color:var(--text);background:var(--hover)}
.toc .act{margin-left:auto;display:flex;gap:var(--sp-2);align-items:center}
.count{font:var(--fw-semibold) var(--fs-small) var(--mono);color:var(--dim);display:flex;align-items:center;gap:4px}
h2.win{font:var(--fw-bold) var(--fs-small)/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--gold-l);margin:var(--sp-6) 0 0;padding-top:var(--sp-3);border-top:1px solid var(--line)}
section{margin-top:var(--sp-4);scroll-margin-top:48px}
.sh{display:flex;align-items:baseline;gap:var(--sp-3);flex-wrap:wrap;margin-bottom:var(--sp-2)}
h3{font:var(--fw-semibold) var(--fs-title3)/1.2 var(--display);margin:0;display:flex;gap:var(--sp-2);align-items:baseline}
.num{font:var(--fs-small) var(--mono);color:var(--dim)}
.q{color:var(--dim);margin:0;font-size:var(--fs-small)}
.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--sp-3)}
@media (max-width:1100px){.cards{grid-template-columns:1fr}}
.card{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:var(--r);background:var(--panel);overflow:hidden}
.card:hover{border-color:var(--line2)}
.card.picked{border-color:var(--gold);box-shadow:0 0 0 1px var(--gold)}
.card.decided{border-color:color-mix(in srgb,var(--ok) 55%,transparent)}
.ph{display:block;position:relative;aspect-ratio:16/10;overflow:hidden;background:var(--bg2);border-bottom:1px solid var(--line)}
.ph iframe{position:absolute;left:0;top:0;width:1440px;height:900px;border:0;transform-origin:0 0;pointer-events:none;background:var(--bg)}
.missing .ph{display:grid;place-items:center;color:var(--dim);font:var(--fs-small) var(--mono)}.missing{opacity:.55}
.body{padding:var(--sp-2) var(--sp-3);display:flex;flex-direction:column;gap:4px;flex:1}
.title{color:var(--text);font-weight:var(--fw-semibold);text-decoration:none}.title:hover{color:var(--gold-l)}
.body p{margin:0;color:var(--muted);font-size:var(--fs-small);flex:1;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.body p:hover{-webkit-line-clamp:unset}
.tag{align-self:flex-start}
.foot{display:flex;justify-content:space-between;align-items:center;gap:var(--sp-2)}
.origin{font:var(--fs-small) var(--mono);color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pick{display:flex;gap:6px;align-items:center;cursor:pointer;font-weight:var(--fw-semibold);font-size:var(--fs-small);color:var(--gold-l);height:var(--ctl-sm);padding:0 8px;border:1px solid var(--line2);border-radius:var(--r-sm);flex:none}
.pick:has(input:checked){background:var(--gold);color:var(--on-gold);border-color:var(--gold)}
.pick input{accent-color:var(--gold);margin:0}
.note{display:block;width:100%;margin-top:var(--sp-2);resize:vertical;min-height:var(--ctl);padding:4px 8px}
#out{position:fixed;inset:auto 24px 24px auto;max-width:560px;width:calc(100% - 48px);max-height:60vh;display:none;flex-direction:column;gap:8px;background:var(--panel);border-radius:var(--r-lg);padding:var(--sp-3);box-shadow:var(--shadow-3);z-index:20}
#out.on{display:flex}#out textarea{flex:1;min-height:220px;background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:var(--r-sm);font:var(--fs-small)/1.45 var(--mono);padding:8px}
#out .row{display:flex;gap:8px;justify-content:flex-end}
</style></head><body><main>
<h1>The Table · page prototypes</h1>
<p class="lede">Three UX variants per page of the three windows, on Maya's sandbox week (<code class="mono">main/fixtures.js</code>, Thu 29 Oct 14:02) and the <b>v2 baseline</b>: the Dial's colours, macOS density, and two layers (indicative rows first, detail in sheets, popovers and an inspector). See <a class="ui-btn plain sm" href="shared/baseline.html">baseline v2 ↗</a>. The landing page (The Dial) carries the only Dark / Light · PayPal switch. <b>Verdict 6 Oct:</b> the starred variant on each page is chosen. The others stay for reference.</p>
<nav class="toc" aria-label="Pages">${toc}<span class="act"><span class="count" id="cnt"></span><label class="count"><input type="checkbox" class="ui-check" id="pv" checked> previews</label><button class="ui-btn gold sm" id="copy">Copy verdict</button></span></nav>
${sections}
<div id="out" role="dialog" aria-label="Verdict"><b>Verdict</b><textarea id="vt" readonly></textarea><div class="row"><button class="ui-btn sm" id="close">Close</button><button class="ui-btn gold sm" id="cp2">Copy to clipboard</button></div></div>
</main>
<script>
const KEY='table-proto-verdict-v1';
let st={};try{st=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){}
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(st))}catch(e){}};
const pages=[...document.querySelectorAll('section[id]')].map(s=>s.id);
function paint(){let n=0;pages.forEach(p=>{const pick=st[p]&&st[p].pick;document.querySelectorAll('.card[data-page="'+p+'"]').forEach(c=>c.classList.toggle('picked',String(pick)===c.dataset.v));if(pick)n++;});document.getElementById('cnt').textContent=n+'/'+pages.length+' picked';}
document.querySelectorAll('input[type=radio]').forEach(r=>{const p=r.name.slice(5);if(st[p]&&String(st[p].pick)===r.value)r.checked=true;r.addEventListener('change',()=>{st[p]=Object.assign(st[p]||{},{pick:Number(r.value)});save();paint();});});
document.querySelectorAll('textarea.note').forEach(t=>{const p=t.dataset.page;t.value=(st[p]&&st[p].note)||'';t.addEventListener('input',()=>{st[p]=Object.assign(st[p]||{},{note:t.value});save();});});
paint();
function verdict(){const L=['# Page prototype verdict ('+new Date().toISOString().slice(0,10)+')',''];pages.forEach(p=>{const s=st[p]||{};const h=document.querySelector('#'+p+' h3').textContent.replace(/^\\d+/,'');const c=s.pick&&document.querySelector('.card[data-page="'+p+'"][data-v="'+s.pick+'"]');L.push('- **'+h+'**: '+(c?'v'+s.pick+' · '+c.dataset.name:'no pick')+(s.note?' — '+s.note.trim():''));});return L.join('\\n');}
const out=document.getElementById('out'),vt=document.getElementById('vt');
document.getElementById('copy').onclick=()=>{vt.value=verdict();out.classList.add('on');vt.select();};
document.getElementById('close').onclick=()=>out.classList.remove('on');
document.getElementById('cp2').onclick=async()=>{try{await navigator.clipboard.writeText(vt.value);document.getElementById('cp2').textContent='Copied';}catch(e){vt.select();document.execCommand&&document.execCommand('copy');}};
// Live previews: scale a 1440x900 iframe into each card, load only near the viewport.
const fit=()=>document.querySelectorAll('.ph iframe').forEach(f=>{const w=f.parentElement.clientWidth;f.style.transform='scale('+(w/1440)+')';});
addEventListener('resize',fit);fit();
const pv=document.getElementById('pv');let io;
function arm(){if(io)io.disconnect();if(!pv.checked){document.querySelectorAll('.ph iframe').forEach(f=>{f.removeAttribute('src');});return;}
io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting&&!e.target.getAttribute('src')){e.target.src=e.target.dataset.src;}}),{rootMargin:'400px'});
document.querySelectorAll('.ph iframe').forEach(f=>io.observe(f));}
pv.onchange=arm;arm();
</script></body></html>`;
fs.writeFileSync(path.join(here, 'index.html'), html);
console.log(`wrote prototype/index.html · ${built} variants present, ${missing} missing`);
