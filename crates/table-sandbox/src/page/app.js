// The live page. It polls the sandbox's read-only API and draws what the wallet answered.
// Agent-supplied arguments are untrusted text: they only ever reach the page through
// textContent, never as markup. The haggle rail's positions come from the server's `rail`
// (src/rail.rs, computed from the journal and unit-tested there); this file only places them.
"use strict";

const $ = (id) => document.getElementById(id);
let after = 0;
let entries = [];
let state = null;
const flashed = new Set();
// The newest feed row, so repeated reads of the table fold into one line (×N).
let newest = null;
const READS = new Set(["table_view", "market_reference"]);
// What the rail last drew, so only a change that arrived moves or rings anything.
let drawn = null;
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

// ?theme=light or ?theme=dark pins the theme; otherwise the system's choice holds.
(() => {
  const theme = new URLSearchParams(location.search).get("theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
})();

function text(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}
function money(cents) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return sign + "$" + Math.floor(abs / 100) + "." + String(abs % 100).padStart(2, "0");
}
function hex(bytes) {
  return Array.isArray(bytes) ? bytes.map((b) => Number(b).toString(16).padStart(2, "0")).join("") : "";
}
// A position from the rail (basis points of the lane) as a CSS length.
function pos(x) {
  return x / 100 + "%";
}
// Restart a CSS animation class on an element.
function replay(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

const STATES = {
  PAIRING: "Opening the table",
  LISTED: "The house seller listed it",
  NEGOTIATING: "Haggling",
  AGREED: "Agreed, waiting for you",
  AWAITING_APPROVAL: "Waiting for you in person",
  SETTLING: "Waiting for you",
  WITHDRAWN: "Your agent walked away",
  EXPIRED: "The table's time ran out",
  REFUSED: "Refused",
  VOIDED: "Voided",
  AUTO_VOIDED: "Voided by its deadline",
};
const AUDIT = {
  "counterparty.pinned": "Paired with the house seller",
  "mandate.signed": "Your rule signed by your key",
  "deal.created": "Joined the house seller's table",
  "deadline.set": "Deadline set: silence moves no money",
  "relay.bound": "Message route bound",
  "intent.refused": "Refused your agent",
  "run.start": "Agent run started",
  "run.end": "Agent run ended",
  "mcp.outcome": "Told your agent the outcome",
  "market.checked": "Rule 9: checked the market price (sample prices)",
  "market.observed": "Stored the market price for your agent to read",
};
function auditWords(row) {
  if (row.action === "envelope.accepted") {
    return row.actor.startsWith("peer:") ? "House seller's signed message verified" : "Your agent's offer signed by the wallet";
  }
  if (row.action === "deal.transition" && row.to) {
    return "Deal now: " + (STATES[row.to] || row.to.toLowerCase().replace(/_/g, " "));
  }
  return AUDIT[row.action] || "Wallet record";
}

function renderFacts() {
  const s = state;
  // The three counters: the wallet's own deal state, the PayPal recorder, the journal's tally.
  text("moved", s.money ? s.money.moved : "-");
  $("moved-card").classList.toggle("bad", Boolean(s.money && s.money.moved_cents > 0));
  const buyer = s.paypal.buyer;
  text("paypal", String(buyer));
  $("paypal-card").classList.toggle("bad", buyer > 0);
  text("paypal-house", "times by your wallet · the house seller: " + s.paypal.house);
  const before = Number($("refused-big").textContent) || 0;
  text("refused-big", String(s.refused));
  if (s.refused > before && drawn && !reduced.matches) replay($("refused-card"), "flash");

  text("rule-ceiling", s.rule.ceiling);
  text("rule-rounds", String(s.rule.rounds));
  text("rule-in-person", s.rule.in_person);
  text("rule-per-deal", s.rule.per_deal);
  const url = "http://127.0.0.1:" + s.port + "/mcp";
  // Agent app names appear only inside the copyable commands, never in the page's own words.
  text("cmd-add", "claude mcp add --transport http table-wallet " + url);
  text("cmd-config", "# ~/.codex/config.toml\n[mcp_servers.table-wallet]\nurl = \"" + url + "\"");
  text("calls", String(s.calls));
  text("answered", String(s.answered));
  text("refused", String(s.refused));
  $("connect").hidden = s.calls > 0;

  const live = s.calls > 0;
  $("status").classList.toggle("live", live || s.rehearsing);
  const table = " · table " + s.table_number;
  text(
    "status-text",
    s.rehearsing ? "Scripted rehearsal (no AI) playing" + table
      : s.rehearsal ? "Scripted rehearsal (no AI) finished" + table
        : live ? "Agent connected" + table : "Waiting for your agent",
  );
  for (const id of ["rehearse", "rehearse-top"]) {
    const button = $(id);
    button.disabled = s.rehearsing;
    button.textContent = s.rehearsing ? "Rehearsal playing" : "Play the rehearsal";
  }
  $("rehearse-top").classList.toggle("gold", s.calls === 0);

  const deal = s.deal;
  renderBanner(deal);
  renderSafety(s.safety);
  renderProof(s.proof);
  renderAudit(s.audit || []);
}

// A deal's state in words; a deadline's safe default is told as itself, never as the agent's act.
function stateWords(deal) {
  if (deal.decided_by && deal.decided_by.type === "safe_default") {
    return "The table's time ran out, and its safe default closed it";
  }
  return STATES[deal.state] || deal.state.toLowerCase().replace(/_/g, " ");
}

function renderBanner(deal) {
  const fresh = $("fresh");
  let title = "";
  let body = "";
  const agreed = state.rail && state.rail.agreed;
  if (deal && !deal.terminal && agreed && agreed.cents > state.rule.in_person_cents) {
    title = "The house seller said yes to " + money(agreed.cents) + ". Your agent cannot close it.";
    body = "Agreeing over " + state.rule.in_person + " needs you in person, and no owner is present in this sandbox. The deal waits for a person; no money moved.";
  } else if (deal && ["AGREED", "AWAITING_APPROVAL", "SETTLING"].includes(deal.state)) {
    title = "Your agent got the house seller to " + deal.price + ". It cannot pay.";
    body = "Agreeing over " + state.rule.in_person + " needs you in person, and no owner is present in this sandbox. No money moved.";
  } else if (deal && deal.terminal) {
    title = stateWords(deal) + ". No money moved.";
    body = "Open a fresh table to try again: a new house seller, the same rule you signed.";
  }
  $("banner").hidden = title === "";
  text("banner-title", title);
  text("banner-text", body);
  fresh.classList.toggle("gold", Boolean(deal && deal.terminal));
}

// ---- the haggle rail ---------------------------------------------------------------------------

function place(el, x) {
  el.style.left = pos(x);
}
function renderRail() {
  const r = state.rail;
  if (!r) return;
  const first = drawn === null;
  const rescaled = !first && (drawn.lo !== r.lo || drawn.hi !== r.hi);
  const still = first || rescaled || reduced.matches;

  // The scale and the two signed lines.
  const ticks = $("ticks");
  ticks.textContent = "";
  for (const t of r.ticks) {
    const tick = document.createElement("span");
    tick.className = "tick";
    place(tick, t.x);
    const label = document.createElement("span");
    label.className = "tick-label";
    place(label, t.x);
    label.textContent = "$" + Math.round(t.cents / 100);
    ticks.append(tick, label);
  }
  place($("wall"), r.wall.x);
  text("wall-label", "Rule 4: never offer over " + money(r.wall.cents));
  place($("gate"), r.gate.x);
  text("gate-label", "Rule 6: agreeing over " + money(r.gate.cents) + " needs you");
  place($("call"), r.gate.x);
  text("call-label", "needs you in person");

  // Every price each side signed, fading with age.
  const trail = $("trail");
  trail.textContent = "";
  for (const side of ["them", "you"]) {
    const all = r["trail_" + side];
    all.forEach((m, i) => {
      const dot = document.createElement("span");
      dot.className = "trail-dot " + side;
      place(dot, m.x);
      dot.style.opacity = String(0.25 + 0.55 * ((i + 1) / all.length));
      trail.append(dot);
    });
  }

  // The markers: each moves only when a new signed price arrived.
  for (const side of ["them", "you"]) {
    const puck = $("puck-" + side);
    const mark = r[side];
    puck.hidden = !mark;
    if (!mark) continue;
    if (still) puck.style.transition = "none";
    place(puck, mark.x);
    text("puck-" + side + "-tag", money(mark.cents));
    if (still) {
      void puck.offsetWidth;
      puck.style.transition = "";
    }
    const was = drawn && drawn[side];
    if (!first && !reduced.matches && (!was || was.cents !== mark.cents)) replay(puck, "landed");
  }
  // Agreed: both sides stand on the one price, as the Corridor's snap shows it.
  $("track").classList.toggle("met", Boolean(r.agreed));
  text("you-price", r.agreed ? money(r.agreed.cents) : r.you ? money(r.you.cents) : "-");
  text("them-price", r.agreed ? money(r.agreed.cents) : r.them ? money(r.them.cents) : "-");
  if (r.agreed) {
    text("gap", money(r.agreed.cents));
    text("gap-words", "agreed");
  } else if (r.you && r.them) {
    text("gap", money(Math.abs(r.them.cents - r.you.cents)));
    text("gap-words", "apart");
  } else {
    text("gap", " ");
    text("gap-words", " ");
  }
  text("offers", r.offers + " of " + state.rule.rounds + " offers signed");

  const agreed = $("agreed");
  agreed.hidden = !r.agreed;
  if (r.agreed) {
    place(agreed, r.agreed.x);
    text("agreed-tag", money(r.agreed.cents) + (r.agreed.cents > r.gate.cents ? " · waits for you" : ""));
  }

  // Refused calls: an X where each landed, the newest brightest; the line it hit lights up.
  const hits = $("hits");
  hits.textContent = "";
  const placed = r.hits.filter((h) => h.x !== null);
  placed.slice(-6).forEach((h, i, shown) => {
    const mark = document.createElement("span");
    mark.className = "hit-mark" + (h.at === "gate" ? " gate-hit" : "") + (i < shown.length - 1 ? " old" : "");
    place(mark, h.x);
    const tag = document.createElement("span");
    tag.className = "hit-tag num";
    tag.textContent = (h.tool === "accept_offer" ? "accept " : "") + (h.cents !== null ? money(h.cents) : "") + (h.past ? (h.x === 0 ? " ←" : " →") : "");
    // Only the newest refusal carries its figure, so tags never pile up on one line.
    if (i === shown.length - 1) mark.append(tag);
    hits.append(mark);
  });
  const last = r.hits.length ? r.hits[r.hits.length - 1] : null;
  $("wall").classList.toggle("hit", Boolean(last && last.at === "wall"));
  $("gate").classList.toggle("hit", Boolean(last && last.at === "gate"));
  const doors = r.hits.filter((h) => h.at === "door");
  $("door").hidden = doors.length === 0;
  if (doors.length) {
    const names = [...new Set(doors.map((h) => h.tool || "a call"))].slice(-3).join(", ");
    text("door", "Turned away at the door, before any price: " + names);
  }

  // The lunge: a newly refused call runs at the line it hit and falls back. The agent's own
  // marker stays on its last signed price; nothing animates for a call that did not arrive.
  const seen = drawn ? drawn.lastHit : 0;
  const fresh = r.hits.filter((h) => h.seq > seen && h.x !== null);
  const ghost = $("ghost");
  if (!first && fresh.length && !reduced.matches) {
    const h = fresh[fresh.length - 1];
    const from = r.you ? r.you.x : 0;
    ghost.hidden = false;
    ghost.style.setProperty("--from", pos(from));
    ghost.style.setProperty("--to", pos(h.x));
    replay(ghost, "go");
  }

  renderCaption(last);
  drawn = { lo: r.lo, hi: r.hi, you: r.you, them: r.them, lastHit: last ? last.seq : seen };
}

// The one line under the rail: the latest thing that happened at this table, in the journal's words.
function renderCaption(lastHit) {
  const caption = $("caption");
  const told = $("caption-told");
  const number = state.table_number;
  let latest = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.table !== number) break;
    if (e.marker || !e.tool || READS.has(e.tool)) continue;
    latest = e;
    break;
  }
  caption.className = "caption";
  told.hidden = true;
  const r = state.rail;
  if (latest && latest.outcome === "refused" && lastHit && lastHit.seq === latest.seq) {
    const what = lastHit.tool === "send_offer" && lastHit.cents !== null ? "an offer of " + money(lastHit.cents)
      : lastHit.tool === "accept_offer" && lastHit.cents !== null ? "agreeing at " + money(lastHit.cents)
        : lastHit.tool;
    caption.textContent = "Refused " + what + ". " + lastHit.rule.charAt(0).toUpperCase() + lastHit.rule.slice(1) + ".";
    caption.classList.add(lastHit.at === "gate" ? "gold" : "no");
    if (lastHit.told) {
      told.textContent = "Told your agent: " + lastHit.told;
      told.hidden = false;
    }
  } else if (r && r.agreed) {
    caption.textContent = "The house seller said yes to " + money(r.agreed.cents) + ". Over " + money(r.gate.cents) + " that needs you in person, so the deal waits. No money moved.";
    caption.classList.add("gold");
  } else if (latest && latest.outcome === "answered" && latest.tool === "send_offer" && r && r.you) {
    caption.textContent = "Your agent offered " + money(r.you.cents) + ". Inside your signed rule: the wallet signed it and sent it to the house seller.";
  } else if (r && r.them) {
    caption.textContent = "The house seller is at " + money(r.them.cents) + ". Your agent's offers appear here as the wallet signs them.";
  }
}

// ---- the wallet's own record -------------------------------------------------------------------

function renderSafety(safety) {
  const el = $("safety");
  el.textContent = "";
  if (!safety) {
    el.textContent = "-";
    return;
  }
  const line = (cls, words) => {
    const div = document.createElement("div");
    if (cls) div.className = cls;
    div.textContent = words;
    el.append(div);
  };
  line(safety.intact ? "ok" : "no", safety.intact ? "Audit chain intact: " + safety.records + " records, each hashed into the next" : "Audit chain broken");
  line(safety.violations_total === 0 ? "ok" : "no", safety.violations_total + " safety violations across the whole ledger");
  line("", safety.refusals + " agent requests refused, each written down before the agent heard no");
  line("", "PayPal calls on refused deals: " + safety.refused_deal_calls);
  const head = hex(safety.head);
  if (head) line("hash", "head " + head.slice(0, 16) + "…");
}

function renderProof(proof) {
  const el = $("proof");
  el.textContent = "";
  if (!proof) return;
  const head = document.createElement("div");
  head.className = proof.verified ? "ok" : "no";
  head.textContent = proof.verified
    ? "This table's proof file verifies offline: " + proof.passed + " checks pass"
    : "This table's proof file: " + proof.passed + " of " + proof.applies + " checks pass";
  const link = document.createElement("a");
  link.href = "/api/proof";
  link.textContent = "Download the proof file";
  const how = document.createElement("div");
  how.className = "small";
  how.textContent = "Check it yourself: cargo run -p table-verify --bin table-verify -- <file>";
  el.append(head, link, how);
}

function renderAudit(rows) {
  const list = $("audit");
  list.textContent = "";
  for (const row of rows.slice(0, 7)) {
    const li = document.createElement("li");
    if (row.action === "intent.refused") li.className = "refusal";
    const seq = document.createElement("span");
    seq.className = "seq";
    seq.textContent = "#" + row.seq;
    const words = document.createElement("span");
    words.textContent = auditWords(row);
    li.append(seq, words);
    list.append(li);
  }
}

function ruleKey(entry) {
  if (entry.clause === 4 || entry.clause === 6 || entry.clause === 3) return String(entry.clause);
  if (entry.code === "tool_absent" || entry.code === "malformed_call") return "door";
  return null;
}
function renderRules() {
  const hits = { 4: 0, 6: 0, 3: 0, door: 0 };
  for (const e of entries) {
    if (e.outcome !== "refused") continue;
    const key = ruleKey(e);
    if (key) hits[key] += 1;
  }
  for (const key of Object.keys(hits)) {
    text("hits-" + key, hits[key] ? "held ×" + hits[key] : "");
    $("rule-" + key).classList.toggle("held", hits[key] > 0);
  }
}

function flash(entry) {
  if (entry.outcome !== "refused" || flashed.has(entry.seq)) return;
  flashed.add(entry.seq);
  const key = ruleKey(entry);
  if (!key) return;
  const el = $("rule-" + key);
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 1600);
}

// ---- the call list -----------------------------------------------------------------------------

function argsLine(entry) {
  if (!entry.args || typeof entry.args !== "object") return "";
  const a = entry.args;
  if (entry.tool === "send_offer" && a.price !== undefined) return "$" + String(a.price);
  if (entry.tool === "accept_offer" && a.offer_seq !== undefined) return "offer #" + String(a.offer_seq);
  if (entry.tool === "withdraw_offer" && a.reason !== undefined) return String(a.reason).toLowerCase();
  const raw = JSON.stringify(a);
  return raw === "{}" ? "" : raw.slice(0, 80);
}

function item(entry) {
  const li = document.createElement("li");
  if (entry.marker === true) {
    li.className = "call-row marker";
    li.textContent = entry.rule;
    return li;
  }
  const quiet = entry.outcome === "protocol" || (entry.outcome === "answered" && READS.has(entry.tool));
  li.className = "call-row " + entry.outcome + (quiet ? " quiet" : "");
  const head = document.createElement("div");
  head.className = "call-head";
  const verdict = document.createElement("span");
  verdict.className = "verdict";
  verdict.textContent = { refused: "No", answered: "Yes", error: "Turned away", protocol: "Connected" }[entry.outcome] || entry.outcome;
  const tool = document.createElement("span");
  tool.className = "tool";
  tool.textContent = entry.tool || entry.method;
  const args = document.createElement("span");
  args.className = "args";
  args.textContent = argsLine(entry);
  const time = document.createElement("span");
  time.className = "time";
  time.textContent = new Date(entry.at).toLocaleTimeString();
  const count = document.createElement("span");
  count.className = "count";
  if (quiet) {
    const rule = document.createElement("span");
    rule.className = "quiet-rule";
    rule.textContent = entry.rule;
    head.append(verdict, tool, count, rule, time);
    li.append(head);
    return li;
  }
  head.append(verdict, tool, args, time);
  li.append(head);
  const rule = document.createElement("div");
  rule.className = "rule-line";
  rule.textContent = entry.rule.charAt(0).toUpperCase() + entry.rule.slice(1);
  li.append(rule);
  if (entry.detail) {
    const detail = document.createElement("div");
    detail.className = "detail";
    detail.textContent = entry.detail;
    li.append(detail);
  }
  if (entry.outcome === "refused") {
    if (entry.told) {
      const told = document.createElement("div");
      told.className = "said";
      told.textContent = "Told your agent: " + entry.told;
      li.append(told);
    }
    const pp = document.createElement("div");
    pp.className = "pp";
    pp.textContent = "PayPal asked: " + String(entry.paypal);
    li.append(pp);
  }
  return li;
}

async function tick() {
  try {
    const [next, fresh] = await Promise.all([
      fetch("/api/state").then((r) => r.json()),
      fetch("/api/journal?after=" + after).then((r) => r.json()),
    ]);
    state = next;
    const list = $("calls-list");
    for (const entry of fresh) {
      entries.push(entry);
      const read = entry.outcome === "answered" && READS.has(entry.tool);
      if (read && newest && newest.tool === entry.tool && newest.table === entry.table) {
        newest.count += 1;
        newest.counter.textContent = "×" + newest.count;
        newest.time.textContent = new Date(entry.at).toLocaleTimeString();
      } else {
        const li = item(entry);
        list.prepend(li);
        newest = read ? { tool: entry.tool, table: entry.table, count: 1, counter: li.querySelector(".count"), time: li.querySelector(".time") } : null;
      }
      flash(entry);
      after = Math.max(after, entry.seq);
    }
    if (entries.length > 400) entries = entries.slice(-400);
    while (list.children.length > 120) list.lastElementChild.remove();
    $("empty").hidden = after > 0;
    renderFacts();
    renderRules();
    renderRail();
  } catch (_) {
    text("status-text", "The sandbox stopped");
    $("status").classList.remove("live");
  }
}

$("fresh").addEventListener("click", async () => {
  const button = $("fresh");
  button.disabled = true;
  button.textContent = "Opening…";
  try {
    await fetch("/api/fresh", { method: "POST", headers: { "x-sandbox": "fresh" } });
  } finally {
    button.disabled = false;
    button.textContent = "Open a fresh table";
    tick();
  }
});

for (const id of ["rehearse", "rehearse-top"]) {
  $(id).addEventListener("click", async () => {
    for (const other of ["rehearse", "rehearse-top"]) $(other).disabled = true;
    try {
      await fetch("/api/rehearse", { method: "POST", headers: { "x-sandbox": "rehearse" } });
    } finally {
      tick();
    }
  });
}

for (const button of document.querySelectorAll("button.copy")) {
  button.addEventListener("click", async () => {
    const source = $(button.dataset.copy);
    if (!source) return;
    try {
      await navigator.clipboard.writeText(source.textContent);
      button.textContent = "Copied";
    } catch (_) {
      // No clipboard (an older browser or a denied permission): select it for a manual copy.
      const range = document.createRange();
      range.selectNodeContents(source);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      button.textContent = "Selected";
    }
    setTimeout(() => (button.textContent = "Copy"), 1400);
  });
}

tick();
setInterval(tick, 700);
