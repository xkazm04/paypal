// The Circuit (setup / settings, prototype/pages/setup/variant-2): the money path drawn as wired
// parts, Your agents → pause switch → Agent app → Your rules → Saved keys → PayPal, with the
// house seller hanging off PayPal. Pure: from the settings snapshot, engine_status and
// mandate_list it derives each part's state, the wires, the breaks (what is missing, with the one
// act that fixes it) and what the contract cannot tell (drawn dashed, never green).

import type { EngineId } from '@bindings/EngineId';
import type { EngineInfo } from '@bindings/EngineInfo';
import type { HouseState } from '@bindings/HouseState';

export type PartId = 'agents' | 'engine' | 'lock' | 'mandate' | 'keychain' | 'paypal' | 'house';

/** ←/→ order on the picture (the bracket tag sits between the engine and the mandate check). */
export const PART_ORDER: readonly PartId[] = ['agents', 'engine', 'lock', 'mandate', 'keychain', 'paypal', 'house'];

export const PART_NAME: Record<PartId, string> = {
  agents: 'Your agents', engine: 'Agent app', lock: 'Approval lock', mandate: 'Your rules',
  keychain: 'Saved keys', paypal: 'PayPal', house: 'House seller',
};

/** ok = closed · break = missing (red, dashed) · wait = needs a moment or the owner (gold/coral)
 *  · unknown = the contract cannot tell (dashed, never green) · off = no power reaches it · idle. */
export type PartState = 'ok' | 'break' | 'wait' | 'unknown' | 'off' | 'idle';
export type WireState = 'live' | 'cut' | 'unknown' | 'open' | 'idle';
export type Tone = 'teal' | 'coral' | 'gold' | 'ok' | 'red' | 'line' | 'dashed' | 'plain';

export type Part = { id: PartId; state: PartState; value: string; chip: { tone: Tone; text: string } };

/** Who may close it: you here (Main), only you in the approval window, or nobody (fixed). */
export type Who = 'you' | 'only-you' | 'fixed';

export type BreakKey = 'engine' | 'credentials' | 'mandate';
export type Break = {
  key: BreakKey;
  part: PartId;
  title: string;
  /** Default on silence: "If you do nothing: <silence> · <then>". */
  silence: string;
  then: string;
  who: Who;
  /** engine: probe again, and (when it is available and not chosen) the scripted engine. */
  scriptedFix: boolean;
};

export type WaitKey = 'paused' | 'house' | 'locked';
export type Wait = { key: WaitKey; part: PartId; title: string; silence: string; then: string };

export type Unknown = { part: PartId; title: string; why: string };

export type MandateLite = { id: string; version: number; notBefore: number; expires: number };

/** The slice of SettingsSnapshot the Circuit reads. */
export type CircuitSettings = {
  agents_paused: boolean;
  selected_engine: EngineId;
  payment_executor_configured: boolean;
  channel3_configured: boolean;
  house: HouseState;
  first_run: boolean;
};

export type CircuitInput = {
  /** null: get_settings not read yet (or failed). */
  settings: CircuitSettings | null;
  /** null: engine_status not read yet (or failed): the engine is unknown, never broken. */
  engines: readonly EngineInfo[] | null;
  /** null: mandate_list not read yet (or failed). */
  mandates: readonly MandateLite[] | null;
  /** Running agent runs, or null when agent_runs is not read. */
  running: number | null;
  locked: boolean;
  now: number;
};

export type Circuit = {
  parts: Record<PartId, Part>;
  /** Power reached this part from the agents (drawn dim when false). */
  powered: Record<PartId, boolean>;
  /** w1 agents→engine (the breaker), w2 engine→mandate, w3 mandate→keychain, w4 keychain→PayPal. */
  wires: { w1: WireState; w2: WireState; w3: WireState; w4: WireState; house: WireState };
  breaks: Break[];
  waits: Wait[];
  unknowns: Unknown[];
  headline: { title: string; chip: { tone: Tone; text: string }; line: string };
  inForce: MandateLite[];
};

const ENGINE_LABEL = (id: EngineId): string => (id === 'scripted' ? 'practice agent' : id);

/** Mandates whose validity window contains `now` (mandate_list already returns only active rows). */
export function mandatesInForce(list: readonly MandateLite[], now: number): MandateLite[] {
  return list.filter((m) => m.notBefore <= now && now < m.expires);
}

function enginePart(s: CircuitSettings | null, engines: readonly EngineInfo[] | null): Part {
  if (!s || !engines) return { id: 'engine', state: 'unknown', value: 'not checked yet', chip: { tone: 'dashed', text: 'unknown' } };
  const sel = s.selected_engine;
  const info = engines.find((e) => e.id === sel);
  if (!info) return { id: 'engine', state: 'break', value: `${ENGINE_LABEL(sel)} not found`, chip: { tone: 'red', text: 'not connected' } };
  if (!info.available) return { id: 'engine', state: 'break', value: `${ENGINE_LABEL(sel)}`, chip: { tone: 'red', text: 'not connected' } };
  return { id: 'engine', state: 'ok', value: ENGINE_LABEL(sel), chip: { tone: 'ok', text: 'ready' } };
}

function mandatePart(list: readonly MandateLite[] | null, inForce: MandateLite[]): Part {
  if (!list) return { id: 'mandate', state: 'unknown', value: 'not loaded', chip: { tone: 'dashed', text: 'unknown' } };
  if (!inForce.length) {
    return { id: 'mandate', state: 'break', value: list.length ? 'none active' : 'none signed', chip: { tone: 'red', text: 'missing' } };
  }
  return { id: 'mandate', state: 'ok', value: `${inForce.length} set${inForce.length > 1 ? 's' : ''} active`, chip: { tone: 'ok', text: 'signed' } };
}

function keychainPart(s: CircuitSettings | null): Part {
  if (!s) return { id: 'keychain', state: 'unknown', value: 'not loaded', chip: { tone: 'dashed', text: 'unknown' } };
  return s.payment_executor_configured
    ? { id: 'keychain', state: 'ok', value: 'PayPal key', chip: { tone: 'ok', text: 'saved' } }
    : { id: 'keychain', state: 'break', value: 'no PayPal key', chip: { tone: 'red', text: 'missing' } };
}

function housePart(s: CircuitSettings | null): Part {
  switch (s?.house) {
    case undefined: return { id: 'house', state: 'unknown', value: 'not loaded', chip: { tone: 'dashed', text: 'unknown' } };
    case 'unavailable': return { id: 'house', state: 'idle', value: 'not in this version', chip: { tone: 'dashed', text: 'unavailable' } };
    case 'idle': return { id: 'house', state: 'idle', value: 'wakes when needed', chip: { tone: 'plain', text: 'asleep' } };
    case 'waking': return { id: 'house', state: 'wait', value: 'waking up · about 1 min', chip: { tone: 'gold', text: 'waking' } };
    case 'ready': return { id: 'house', state: 'ok', value: 'ready', chip: { tone: 'ok', text: 'ready' } };
  }
}

/** The wire leaving a part: cut at a break, dashed where unknown, live where power got through. */
function wireAfter(p: Part, powered: boolean): WireState {
  if (p.state === 'break') return 'cut';
  if (p.state === 'unknown') return 'unknown';
  return powered && p.state === 'ok' ? 'live' : 'idle';
}

export function deriveCircuit(input: CircuitInput): Circuit {
  const { settings: s, engines, mandates, running, locked, now } = input;
  const inForce = mandates ? mandatesInForce(mandates, now) : [];
  const paused = !!s?.agents_paused;

  const agents: Part = !s
    ? { id: 'agents', state: 'unknown', value: 'not loaded', chip: { tone: 'dashed', text: 'unknown' } }
    : paused
      ? { id: 'agents', state: 'wait', value: 'all paused', chip: { tone: 'coral', text: 'paused' } }
      : { id: 'agents', state: 'ok', value: running === null ? 'ready' : running ? `${running} working` : 'idle', chip: { tone: 'teal', text: 'ready' } };
  const engine = enginePart(s, engines);
  const mandate = mandatePart(mandates, inForce);
  const keychain = keychainPart(s);
  const lock: Part = locked
    ? { id: 'lock', state: 'wait', value: 'locked', chip: { tone: 'gold', text: 'locked' } }
    : { id: 'lock', state: 'ok', value: 'unlocked', chip: { tone: 'ok', text: 'unlocked' } };
  const house = housePart(s);

  const p1 = !!s && !paused;
  const p2 = p1 && engine.state === 'ok';
  const p3 = p2 && mandate.state === 'ok';
  const p4 = p3 && keychain.state === 'ok';
  const upstream = [engine, mandate, keychain];
  const anyBreak = upstream.some((p) => p.state === 'break');
  const anyUnknown = !s || upstream.some((p) => p.state === 'unknown');

  // PayPal's own reachability is not in the contract: even a closed path is "unknown", never green.
  const paypal: Part = anyBreak
    ? { id: 'paypal', state: 'off', value: 'never called', chip: { tone: 'line', text: 'no calls' } }
    : anyUnknown
      ? { id: 'paypal', state: 'unknown', value: 'not checked yet', chip: { tone: 'dashed', text: 'unknown' } }
      : paused
        ? { id: 'paypal', state: 'off', value: 'agents paused', chip: { tone: 'line', text: 'idle' } }
        : { id: 'paypal', state: 'unknown', value: 'not tested live', chip: { tone: 'dashed', text: 'unknown' } };

  const parts: Record<PartId, Part> = { agents, engine, lock, mandate, keychain, paypal, house };
  const wires = {
    w1: !s ? 'unknown' as const : paused ? 'open' as const : 'live' as const,
    w2: wireAfter(engine, p2),
    w3: wireAfter(mandate, p3),
    w4: wireAfter(keychain, p4),
    house: s?.house === 'ready' ? 'live' as const : 'idle' as const,
  };

  const breaks: Break[] = [];
  if (engine.state === 'break') {
    const scripted = engines?.find((e) => e.id === 'scripted');
    breaks.push({ key: 'engine', part: 'engine', title: 'Agent app not connected', silence: 'agents can’t start', then: 'no money moves', who: 'you',
      scriptedFix: !!scripted?.available && s?.selected_engine !== 'scripted' });
  }
  if (keychain.state === 'break') breaks.push({ key: 'credentials', part: 'keychain', title: 'PayPal key not saved', silence: 'nothing is saved', then: 'PayPal is never called', who: 'only-you', scriptedFix: false });
  if (mandate.state === 'break') breaks.push({ key: 'mandate', part: 'mandate', title: mandates?.length ? 'No active rules' : 'No rules signed', silence: 'every agent request is refused', then: 'PayPal is never called', who: 'only-you', scriptedFix: false });

  const waits: Wait[] = [];
  if (paused) waits.push({ key: 'paused', part: 'agents', title: 'Agents paused', silence: 'agents stay paused', then: 'deadlines still release holds' });
  if (s?.house === 'waking') waits.push({ key: 'house', part: 'house', title: 'House seller waking up', silence: 'it keeps waking', then: 'no money moves' });
  if (locked) waits.push({ key: 'locked', part: 'lock', title: 'Approvals locked', silence: 'it stays locked', then: 'no money moves' });

  const unknowns: Unknown[] = [];
  if (!s) unknowns.push({ part: 'agents', title: 'Settings', why: 'they have not loaded yet' });
  if (engine.state === 'unknown') unknowns.push({ part: 'engine', title: 'Agent app', why: 'it has not answered yet' });
  if (mandate.state === 'unknown') unknowns.push({ part: 'mandate', title: 'Your rules', why: 'they have not loaded yet' });
  if (paypal.state === 'unknown') unknowns.push({ part: 'paypal', title: 'PayPal connection', why: 'the wallet does not test PayPal live, so it can’t say' });

  let headline: Circuit['headline'];
  if (!s) headline = { title: 'Checking…', chip: { tone: 'dashed', text: 'unknown' }, line: 'settings have not loaded yet' };
  else if (breaks.length) headline = { title: `${breaks.length} thing${breaks.length > 1 ? 's' : ''} to fix`, chip: { tone: 'red', text: 'not ready' }, line: 'agents can’t spend until it’s fixed' };
  else if (paused) headline = { title: 'Agents paused', chip: { tone: 'coral', text: 'paused' }, line: 'nothing new starts · deadlines still release holds' };
  else if (anyUnknown) headline = { title: 'Some parts haven’t answered', chip: { tone: 'dashed', text: 'unknown' }, line: 'nothing is assumed to work' };
  else headline = { title: 'Ready', chip: { tone: 'ok', text: 'ready' }, line: 'agents may act inside your rules' };

  const powered: Record<PartId, boolean> = { agents: true, engine: p1, lock: true, mandate: p2, keychain: p3, paypal: p4, house: true };
  return { parts, powered, wires, breaks, waits, unknowns, headline, inForce };
}

export type SettingsAnswer = { tone: 'calm' | 'need' | 'alert' | 'done'; title: string; sub: string };

/** "Is my wallet ready, and what's missing?" in one sentence (the sheet's AnswerBar). Gold (`need`)
 *  when something is missing or paused, never green while a part has not answered. */
export function settingsAnswer(c: Circuit, o: { firstRun: boolean; settingsKnown: boolean; locked: boolean }): SettingsAnswer {
  if (!o.settingsKnown) return { tone: 'calm', title: 'Checking your wallet…', sub: 'Reading your settings. Nothing is assumed to work until it answers.' };
  const n = c.breaks.length;
  if (n) {
    return {
      tone: 'need',
      title: o.firstRun ? 'Let’s get your wallet ready' : 'Your wallet isn’t ready yet',
      sub: `${n} ${n === 1 ? 'step is' : 'steps are'} left. Until then no agent can spend and no money moves.`,
    };
  }
  if (c.parts.agents.state === 'wait') return { tone: 'need', title: 'Your agents are paused', sub: 'Nothing new starts. Deadlines still release holds by themselves.' };
  if (c.unknowns.some((u) => u.part !== 'paypal')) return { tone: 'calm', title: 'Still checking a few things', sub: 'Nothing is assumed to work until it answers.' };
  if (o.locked) return { tone: 'calm', title: 'Your wallet is ready', sub: 'Approving is locked for now. Unlock with Windows Hello when you need to.' };
  return { tone: 'done', title: 'Your wallet is ready', sub: 'Your agents may act, but only inside the rules you signed.' };
}

/** The three required steps (PayPal key, signed rules, agent app) and how many are done. */
export function setupProgress(c: Circuit): { done: number; total: number } {
  const need: PartId[] = ['keychain', 'mandate', 'engine'];
  return { done: need.filter((p) => c.parts[p].state === 'ok').length, total: need.length };
}

/** Which part to select first: the first break on a first run, else PayPal (the authorities). */
export function initialPart(c: Circuit, firstRun: boolean): PartId {
  const b = c.breaks[0];
  if (b) return b.part;
  return firstRun ? 'agents' : 'paypal';
}

/** ←/→ through PART_ORDER, wrapping. */
export function stepPart(cur: PartId, dir: 1 | -1): PartId {
  const i = PART_ORDER.indexOf(cur);
  const n = PART_ORDER.length;
  return PART_ORDER[(i + dir + n) % n] ?? cur;
}
