// The UX-friction log. Each beat collects: the clicks it took, dead ends, unclear copy, the three
// questions the owner could not answer ("where am I", "what happens next", "did it work"), and the
// module words a screen used without explaining them. The automatic checks below are crude on
// purpose (they read words off the screen); the owner's own notes, typed at the pause cards, and the
// dry-run's reviewer notes sit beside them in friction.md.

/** Words that belong to the machinery: UX-GUIDE.md says they never reach Layer 1. */
export const INTERNAL = [
  'mandate', 'clause', 'spike', 'conformance', 'isolation', 'envelope', 'projection',
  'UNAVAILABLE', 'PERMISSION', 'backend', 'ULID', 'JWS', 'policy:', 'scripted',
];
/** The product's own words a first-time creator meets: fine once explained, friction when not. */
export const MODULE = [
  'charter', 'Tables', 'Counter', 'Spend', 'Rescue', 'Shield', 'Book', 'Rewind', 'house seller',
  'practice agent', 'practice deal', 'agent app', 'four words', 'owner key', 'listing code', 'sandbox',
  'Ask me above', 'price range', 'least you’ll accept', 'approved payees', 'payee', 'Windows Hello',
  'negotiator', 'decision centre', 'Tumbler', 'mini window', 'Break it', 'Board', 'Proof', 'Paid to',
];

const has = (body, word) => new RegExp(`(^|[^A-Za-z])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z]|$)`, word === word.toLowerCase() ? 'i' : '').test(body);

/** Automatic findings for one window as read now (see App.read). */
export function screenChecks(win, r) {
  if (!r) return [];
  const out = [];
  const body = r.body || '';
  for (const w of INTERNAL) if (has(body, w)) out.push({ kind: 'unclear-copy', severity: 'high', window: win, text: `internal word on screen: "${w}"`, evidence: snippet(body, w) });
  const unexplained = MODULE.filter((w) => has(r.content ?? body, w));
  if (unexplained.length) {
    out.push({
      kind: 'module-terms', severity: r.infos > 0 ? 'low' : 'medium', window: win,
      text: `module words on screen: ${unexplained.join(', ')}${r.infos > 0 ? ` (${r.infos} ⓘ / "How it works" affordances on the screen)` : ' (no ⓘ or "How it works" on this screen)'}`,
    });
  }
  if (r.headings.length === 0) out.push({ kind: 'where-am-i', severity: 'medium', window: win, text: 'no heading on screen: the owner cannot tell where they are' });
  if (!/If you do nothing|next|Next/.test(body) && r.gold.length === 0) out.push({ kind: 'what-next', severity: 'low', window: win, text: 'no "If you do nothing" line, next step or gold action on screen' });
  if (r.gold.length > 1) out.push({ kind: 'what-next', severity: 'medium', window: win, text: `${r.gold.length} gold actions in one view (UX-GUIDE: never two): ${r.gold.slice(0, 3).join(' · ')}` });
  return out;
}

/** The setup counts the three places show at the same moment; they should agree. */
export function countChecks(reads) {
  const found = [];
  const m = reads.main?.body.match(/(\d) of (\d) lines signed/);
  if (m) found.push({ where: 'The Table charter', done: Number(m[1]), of: Number(m[2]), text: m[0] });
  const a = reads.approval?.body.match(/(\d) of (\d) done/);
  if (a) found.push({ where: 'approval window', done: Number(a[1]), of: Number(a[2]), text: a[0] });
  const s = reads.main?.body.match(/(\d) steps? (is|are) left/);
  if (s) found.push({ where: 'Settings', left: Number(s[1]), text: s[0] });
  if (found.length < 2) return { found, findings: [] };
  const lefts = found.map((f) => (f.left !== undefined ? f.left : f.of - f.done));
  const differ = new Set(lefts).size > 1 || new Set(found.filter((f) => f.of).map((f) => f.of)).size > 1;
  return {
    found,
    findings: differ ? [{ kind: 'did-it-work', severity: 'medium', window: 'several', text: `setup progress disagrees across places: ${found.map((f) => `${f.where} "${f.text}"`).join(' vs ')}` }] : [],
  };
}

function snippet(body, word) {
  const i = body.toLowerCase().indexOf(word.toLowerCase());
  if (i < 0) return '';
  return body.slice(Math.max(0, i - 60), i + word.length + 60).replace(/\s+/g, ' ').trim();
}

/** friction.md: one section per beat, then everything ranked. */
export function frictionMarkdown(run) {
  const L = [];
  L.push(`# Friction log: YouTube sponsorship (${run.mode} run, ${run.startedAt})`);
  L.push('');
  L.push(`Mode: **${run.mode}**${run.mode === 'mock' ? ' (browser preview, sample data; owner steps were simulated through the mock and are labelled so)' : ''}. Pinned clock: ${run.pinnedAt ?? 'wall clock'}.`);
  L.push('');
  L.push('| # | Beat | Actor | Outcome | Time | Clicks | Console errors | Findings |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const b of run.beats) {
    L.push(`| ${b.n} | ${b.title} | ${b.actorShown} | ${b.status} | ${(b.ms / 1000).toFixed(1)} s | ${b.clicks.length} | ${b.consoleErrors.length} | ${b.friction.length} |`);
  }
  L.push('');
  for (const b of run.beats) {
    L.push(`## ${b.n}. ${b.title}`);
    L.push('');
    L.push(`- Actor: ${b.actorShown}. Outcome: **${b.status}** (${b.signal || 'no signal'}). ${(b.ms / 1000).toFixed(1)} s.`);
    if (b.clicks.length) L.push(`- Clicks (${b.clicks.length}): ${b.clicks.map((c) => `${c.simulated ? '(sim) ' : ''}${c.window}: ${c.words || c.why}`).join(' → ')}`);
    if (b.screens.length) L.push(`- Screens: ${b.screens.join(', ')}`);
    if (b.consoleErrors.length) L.push(`- Console errors: ${b.consoleErrors.map((e) => `${e.window}: ${e.text}`).join(' | ')}`);
    for (const f of b.friction) L.push(`- [${f.severity}] ${f.kind} (${f.window}): ${f.text}${f.evidence ? ` - "${f.evidence}"` : ''}`);
    for (const n of b.ownerNotes ?? []) L.push(`- [owner note] ${n}`);
    if (b.gaps?.length) for (const g of b.gaps) L.push(`- [gap] ${g}`);
    L.push('');
  }
  const rank = { high: 0, medium: 1, low: 2 };
  const all = run.beats.flatMap((b) => b.friction.map((f) => ({ ...f, beat: b.n }))).filter((f) => f.kind !== 'module-terms' || f.severity !== 'low');
  all.sort((x, y) => rank[x.severity] - rank[y.severity] || x.beat - y.beat);
  L.push('## Ranked');
  L.push('');
  for (const f of all) L.push(`- [${f.severity}] beat ${f.beat}, ${f.window}: ${f.text}`);
  L.push('');
  return L.join('\n');
}
