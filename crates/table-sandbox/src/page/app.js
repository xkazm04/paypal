// The live page: polls the sandbox's read-only API and renders every call. Agent-supplied
// arguments are untrusted text: they are only ever set with textContent, never as markup.
"use strict";

const $ = (id) => document.getElementById(id);
let after = 0;

function text(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

const STATES = {
  pairing: "Opening the table",
  listed: "The house listed it",
  negotiating: "Haggling",
  agreed: "Agreed: waiting for you in person. No money moved.",
  approved: "You approved it",
  withdrawn: "Your agent walked away. No money moved.",
  expired: "Expired. No money moved.",
};

function render(state) {
  text("paypal", String(state.paypal.buyer));
  text("rule-floor", state.rule.floor);
  text("rule-ceiling", state.rule.ceiling);
  text("rule-in-person", state.rule.in_person);
  text("rule-rounds", String(state.rule.rounds));
  text("item", state.item);
  text("house-ask", "The house opened at " + state.house.ask);
  text("calls", String(state.calls));
  text("answered", String(state.answered));
  text("refused", String(state.refused));
  text("mcp-url", "http://127.0.0.1:" + state.port + "/mcp");
  if (state.deal) {
    text("price", state.deal.price);
    text("deal-state", STATES[state.deal.state] || state.deal.state);
  }
}

function argsLine(entry) {
  if (!entry.args || typeof entry.args !== "object") return "";
  const a = entry.args;
  if (entry.tool === "send_offer" && a.price !== undefined) return "price " + String(a.price);
  if (entry.tool === "accept_offer" && a.offer_seq !== undefined) return "offer #" + String(a.offer_seq);
  if (entry.tool === "withdraw_offer" && a.reason !== undefined) return "reason " + String(a.reason);
  const raw = JSON.stringify(a);
  return raw === "{}" ? "" : raw.slice(0, 80);
}

function item(entry) {
  const li = document.createElement("li");
  li.className = "call " + entry.outcome;
  const head = document.createElement("div");
  head.className = "call-head";
  const verdict = document.createElement("span");
  verdict.className = "verdict";
  verdict.textContent =
    entry.outcome === "refused" ? "Refused" : entry.outcome === "answered" ? "Answered" : entry.outcome === "error" ? "Turned away" : "Connected";
  const tool = document.createElement("span");
  tool.className = "tool";
  tool.textContent = entry.tool || entry.method;
  const args = document.createElement("span");
  args.className = "args";
  args.textContent = argsLine(entry);
  const time = document.createElement("span");
  time.className = "time";
  time.textContent = new Date(entry.at).toLocaleTimeString();
  head.append(verdict, tool, args, time);
  const rule = document.createElement("div");
  rule.className = "rule-line";
  rule.textContent = entry.rule + (entry.detail ? " (" + entry.detail + ")" : "");
  const pp = document.createElement("div");
  pp.className = "pp";
  pp.textContent = "PayPal asked: " + String(entry.paypal);
  li.append(head, rule, pp);
  return li;
}

async function tick() {
  try {
    const [state, entries] = await Promise.all([
      fetch("/api/state").then((r) => r.json()),
      fetch("/api/journal?after=" + after).then((r) => r.json()),
    ]);
    render(state);
    const list = $("calls-list");
    for (const entry of entries) {
      list.prepend(item(entry));
      after = Math.max(after, entry.seq);
    }
    if (after > 0) $("empty").hidden = true;
  } catch (_) {
    text("deal-state", "The sandbox stopped.");
  }
}

tick();
setInterval(tick, 700);
