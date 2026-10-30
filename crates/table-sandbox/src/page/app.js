// The live page. It polls the sandbox's read-only API and draws what the wallet answered.
// Agent-supplied arguments are untrusted text: they only ever reach the page through
// textContent or SVG text nodes, never as markup.
"use strict";

const $ = (id) => document.getElementById(id);
const SVG = "http://www.w3.org/2000/svg";
let after = 0;
let entries = [];
let state = null;
const flashed = new Set();
// The newest feed row, so repeated reads of the table fold into one line (×N).
let newest = null;
const READS = new Set(["table_view", "market_reference"]);

function text(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}
function money(cents) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return sign + "$" + Math.floor(abs / 100) + "." + String(abs % 100).padStart(2, "0");
}
// "329.00" -> 32900, without floating point; null when it is not a price.
function cents(price) {
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(String(price).trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] || "0").padEnd(2, "0"));
}
function hex(bytes) {
  return Array.isArray(bytes) ? bytes.map((b) => Number(b).toString(16).padStart(2, "0")).join("") : "";
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
  const buyer = s.paypal.buyer;
  text("paypal", String(buyer));
  $("paypal-card").classList.toggle("bad", buyer > 0);
  text("paypal-house", "The house seller: " + s.paypal.house);
  text("rule-ceiling", s.rule.ceiling);
  text("rule-rounds", String(s.rule.rounds));
  text("rule-in-person", s.rule.in_person);
  text("rule-per-deal", s.rule.per_deal);
  const url = "http://127.0.0.1:" + s.port + "/mcp";
  text("cmd-claude", "claude mcp add --transport http table-wallet " + url);
  text("cmd-codex", '[mcp_servers.table-wallet] url = "' + url + '"  (in ~/.codex/config.toml)');
  text("cmd-any", "streamable HTTP MCP server: " + url);
  text("calls", String(s.calls));
  text("answered", String(s.answered));
  text("refused", String(s.refused));
  $("connect").hidden = s.calls > 0;

  const live = s.calls > 0;
  $("status").classList.toggle("live", live);
  text("status-text", s.rehearsal ? "Scripted rehearsal (no AI) · table " + s.table_number : live ? "Agent connected · table " + s.table_number : "Waiting for your agent");

  const deal = s.deal;
  const table = s.table && deal && s.table.deal_id === deal.id ? s.table : null;
  if (deal) {
    text("price", deal.price);
    let words = stateWords(deal);
    if (table && !deal.terminal) {
      const left = table.deadline - Math.floor(Date.now() / 1000);
      if (left > 0) words += " · closes in " + Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0");
      if (table.band) words += " · " + table.band.rounds_left + " offers left";
    }
    text("deal-state", words);
  }
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
  const banner = $("banner");
  const fresh = $("fresh");
  let title = "";
  let body = "";
  const table = state.table && deal && state.table.deal_id === deal.id ? state.table : null;
  const yes = table ? yesTo(table.history || []) : null;
  if (deal && !deal.terminal && yes !== null) {
    title = "The house seller said yes to " + money(yes) + ". Your agent cannot close it.";
    body = "Agreeing over " + state.rule.in_person + " needs you in person, and no owner is present in this sandbox. The deal waits for a person; no money moved.";
  } else if (deal && ["AGREED", "AWAITING_APPROVAL", "SETTLING"].includes(deal.state)) {
    title = "Your agent got the house seller to " + deal.price + ". It cannot pay.";
    body = "Agreeing over " + state.rule.in_person + " needs you in person, and no owner is present in this sandbox. No money moved.";
  } else if (deal && deal.terminal) {
    title = stateWords(deal) + ". No money moved.";
    body = "Open a fresh table to try again: a new house seller, the same rule you signed.";
  }
  banner.hidden = title === "";
  text("banner-title", title);
  text("banner-text", body);
  fresh.classList.toggle("gold", Boolean(deal && (deal.terminal || title !== "")));
}

// The price the house said yes to: its ACCEPT after our offer was the last priced step. (The house
// also signs an ACCEPT of its own counter beside each counter; that is not a yes to us.)
function yesTo(history) {
  let priced = null;
  let yes = null;
  for (const step of history) {
    if (step.price) {
      priced = step;
      yes = null;
    } else if (step.act === "accept" && step.by === "them" && priced && priced.by === "you") {
      yes = priced.price.minor;
    }
  }
  return yes;
}

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
  for (const row of rows.slice(0, 9)) {
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

function renderRules() {
  const hits = { 4: 0, 6: 0, 3: 0, door: 0 };
  for (const e of entries) {
    if (e.outcome !== "refused") continue;
    if (e.clause === 4 || e.clause === 6 || e.clause === 3) hits[e.clause] += 1;
    if (e.code === "tool_absent" || e.code === "malformed_call") hits.door += 1;
  }
  const pushes = hits[4] + hits[6] + hits[3] + hits.door;
  $("held").hidden = pushes === 0;
  text("held", "Your agent pushed against a rule " + pushes + (pushes === 1 ? " time" : " times") + ". The rule held every time.");
  for (const key of Object.keys(hits)) {
    text("hits-" + key, hits[key] ? "held ×" + hits[key] : "");
    $("rule-" + key).classList.toggle("held", hits[key] > 0);
  }
}

function flash(entry) {
  if (entry.outcome !== "refused" || flashed.has(entry.seq)) return;
  flashed.add(entry.seq);
  const key = entry.clause === 4 || entry.clause === 6 || entry.clause === 3 ? String(entry.clause) : entry.code === "tool_absent" || entry.code === "malformed_call" ? "door" : null;
  if (!key) return;
  const el = $("rule-" + key);
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 1600);
}

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
  if (entry.method === "sandbox/table") {
    li.className = "call marker";
    li.textContent = entry.rule;
    return li;
  }
  const quiet = entry.outcome === "protocol" || (entry.outcome === "answered" && READS.has(entry.tool));
  li.className = "call " + entry.outcome + (quiet ? " quiet" : "");
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
      told.className = "told";
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

// The price corridor: the signed lines, both sides' signed prices, and every refused attempt.
function el(name, attrs, words) {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (words !== undefined) node.textContent = words;
  return node;
}
function renderChart() {
  const svg = $("chart");
  svg.textContent = "";
  if (!state) return;
  const W = 800, H = 260, L = 54, R = 172, T = 18, B = 26, INSET = 26;
  const deal = state.deal;
  const table = state.table && deal && state.table.deal_id === deal.id ? state.table : null;
  const number = state.table_number;
  const points = [];
  if (table) {
    let priced = null;
    let said = false;
    for (const step of table.history || []) {
      if (step.price && (step.act === "listing" || step.act === "offer" || step.act === "counter" || step.act === "accept")) {
        points.push({ at: step.at * 1000, side: step.by === "you" ? "you" : "them", price: step.price.minor, act: step.act });
        priced = step;
        said = false;
      } else if (step.act === "accept" && step.by === "them" && priced && priced.by === "you" && !said) {
        points.push({ at: step.at * 1000, side: "yes", price: priced.price.minor, act: "accept" });
        said = true;
      }
    }
  } else {
    points.push({ at: 0, side: "them", price: state.house.ask_cents, act: "listing" });
  }
  for (const e of entries) {
    if (e.table !== number || e.outcome !== "refused") continue;
    if (e.tool === "send_offer" && e.args && e.args.price !== undefined) {
      const c = cents(e.args.price);
      if (c !== null) points.push({ at: e.at, side: "refused", price: c, act: "offer", label: "$" + String(e.args.price) });
    } else if (e.tool === "accept_offer" && table && table.their_last_price) {
      points.push({ at: e.at, side: "refused", price: table.their_last_price.minor, act: "accept", label: "accept" });
    }
  }
  points.sort((a, b) => a.at - b.at);
  const prices = points.map((p) => p.price).concat([state.rule.ceiling_cents, state.rule.in_person_cents]);
  const top = Math.max(35500, Math.min(46000, Math.max(...prices) + 1800));
  const bottom = Math.max(0, Math.min(15000, Math.min(...prices) - 1500));
  const y = (c) => T + (H - T - B) * (1 - (Math.min(c, top) - bottom) / (top - bottom));
  const n = Math.max(points.length, 2);
  const x = (i) => L + INSET + ((W - L - R - 2 * INSET) * i) / (n - 1);
  const short = (c) => "$" + Math.round(c / 100);

  for (let c = Math.ceil(bottom / 5000) * 5000; c <= top; c += 5000) {
    svg.append(el("line", { x1: L, x2: W - R, y1: y(c), y2: y(c), class: "grid" }));
    svg.append(el("text", { x: L - 8, y: y(c) + 4, "text-anchor": "end", class: "axis" }, "$" + c / 100));
  }
  if (table && table.market) {
    const m = table.market;
    svg.append(el("rect", { x: L, width: W - R - L, y: y(m.p75.minor), height: Math.max(1, y(m.p25.minor) - y(m.p75.minor)), class: "market-band" }));
    svg.append(el("line", { x1: L, x2: W - R, y1: y(m.median.minor), y2: y(m.median.minor), class: "market-median" }));
    svg.append(el("text", { x: W - R + 8, y: y(m.median.minor) + 4, class: "market-label" }, "Market " + short(m.p25.minor) + "–" + short(m.p75.minor) + " (sample)"));
  }
  const ceil = state.rule.ceiling_cents;
  svg.append(el("line", { x1: L, x2: W - R, y1: y(ceil), y2: y(ceil), class: "ceiling" }));
  svg.append(el("text", { x: W - R + 8, y: y(ceil) + 4, class: "ceiling-label" }, "Rule 4: never over " + short(ceil)));
  const ip = state.rule.in_person_cents;
  svg.append(el("line", { x1: L, x2: W - R, y1: y(ip), y2: y(ip), class: "inperson" }));
  svg.append(el("text", { x: W - R + 8, y: y(ip) + 4, class: "inperson-label" }, "Rule 6: over " + short(ip) + " needs you"));

  for (const side of ["them", "you"]) {
    const idx = points.map((p, i) => [p, i]).filter(([p]) => p.side === side);
    if (idx.length > 1) {
      svg.append(el("polyline", { points: idx.map(([p, i]) => x(i) + "," + y(p.price)).join(" "), class: "line-" + side }));
    }
  }
  points.forEach((p, i) => {
    const px = x(i), py = y(p.price);
    if (p.side === "yes") {
      svg.append(el("circle", { cx: px, cy: py, r: 9, class: "yes-ring" }));
      svg.append(el("text", { x: px, y: py + 24, "text-anchor": "middle", class: "yes-label" }, "house: yes"));
    } else if (p.side === "refused") {
      svg.append(el("line", { x1: px - 6, y1: py - 6, x2: px + 6, y2: py + 6, class: "x" }));
      svg.append(el("line", { x1: px - 6, y1: py + 6, x2: px + 6, y2: py - 6, class: "x" }));
      svg.append(el("text", { x: px, y: py - 11, "text-anchor": "middle", class: "x-label" }, (p.label || "") + " no"));
    } else {
      svg.append(el("circle", { cx: px, cy: py, r: 5, class: "pt-" + p.side }));
      svg.append(el("text", { x: px, y: py + (p.side === "you" ? 18 : -10), "text-anchor": "middle", class: "pt-label" }, money(p.price)));
    }
  });
  if (!table) {
    svg.append(el("text", { x: L + 16, y: H - B - 10, class: "hint" }, "The house seller opened at " + state.house.ask + ". Your agent's moves appear here."));
  }
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
    $("empty").hidden = after > 0;
    renderFacts();
    renderRules();
    renderChart();
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

tick();
setInterval(tick, 700);
