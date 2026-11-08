// The registry: the ONE place the assistant's vocabulary is defined. The validator (validate.ts) reads
// field kinds from it, the prompt (prompt.ts) renders it with describeVocabulary(), and the CLI's JSON
// Schema comes from replyJsonSchema(). The contract (contract.ts) owns the NAMES; the Record types
// below make a new panel kind, op or action in the contract a compile error here until it is described,
// and vocabulary.test.ts fails for the same reason at run time.
// Pure and Node-safe: imports only contract.ts and @bindings types (the dev bridge loads this in Node).
import type { AgentSlot } from '@bindings/AgentSlot';
import type { ApprovalTarget } from '@bindings/ApprovalTarget';
import { ASSISTANT_V, FATES, MODULE_KEYS, PANEL_KINDS, type ActionRef, type PanelKind, type UiOp } from './contract';

/** Hard limits, shared by the validator, the schema and the prompt. */
export const SAY_MAX = 600;
export const OPS_MAX = 8;
export const WHY_MAX = 160;
export const DEAL_ID_MAX = 64;
/** How many answer panels the board's composition region holds at once (windows/main/switchboard/
 *  region.ts). Three: the answer area is one narrow rail beside a board that must stay whole, so a
 *  fourth panel would push the first out of sight and the region would stop reading at a glance; and
 *  one slot is always left for the model (PIN_MAX = REGION_MAX - 1), so the owner's pins never
 *  silence an answer. Not in the prompt yet: the pinned prompt copy (crates/table-client/src/
 *  assistant_contract.json) only changes with a shell rebuild. */
export const REGION_MAX = 3;

/** Setup targets an action may name (the approval window opens on them; nothing is signed here). */
export const SETUP_TARGETS: readonly Extract<ApprovalTarget, 'credentials' | 'mandate' | 'unlock'>[] = ['credentials', 'mandate', 'unlock'];

/** The agents `pause_agent` may name (the wallet's three agent slots). */
export const AGENT_SLOTS: readonly AgentSlot[] = ['negotiator', 'shopper', 'assistant'];

/** Places `open_console` may reach (the console's own places, minus the preview-only director). */
export const CONSOLE_PLACES = ['rules', 'limits', 'connections', 'pairing', 'settings', 'safety', 'try', 'proof'] as const;

/** A deal id inside a hash: a short slug, never free text. */
export const DEAL_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;

/** The hash grammar of `open_console` (a subset of what windows/main/logic.ts parseHash round-trips;
 *  vocabulary.test.ts proves it). The deal form still needs its id to be one the board knows. */
export const HASH_RE = new RegExp(
  `^#(?:m=(?:${MODULE_KEYS.join('|')})|d=[A-Za-z0-9_.-]{1,${DEAL_ID_MAX}}|p=(?:${CONSOLE_PLACES.join('|')})|s=setup|w=waiting|r=rewind)$`,
);

/** What a field holds. The kind decides how it is validated and which schema it gets. */
export type FieldKind = 'module' | 'fate' | 'deal_id' | 'hash' | 'setup_target' | 'agent' | 'why' | 'panel' | 'action';
export type FieldDef = { name: string; kind: FieldKind; nullable: boolean };
export type EntryDef = { name: string; about: string; fields: readonly FieldDef[] };

const f = (name: string, kind: FieldKind, nullable = false): FieldDef => ({ name, kind, nullable });

export const PANELS: Record<PanelKind, EntryDef> = {
  needs: { name: 'needs', about: 'Everything that waits on her, soonest deadline first; module narrows it to one module.', fields: [f('module', 'module', true)] },
  decision: { name: 'decision', about: 'One deal that needs her, with what happens if she does nothing.', fields: [f('deal_id', 'deal_id')] },
  deal: { name: 'deal', about: 'One deal and where its money stands.', fields: [f('deal_id', 'deal_id')] },
  money: { name: 'money', about: 'Room left today, what is held, what was paid.', fields: [] },
  rules: { name: 'rules', about: 'The rules she signed, in plain words; module narrows it.', fields: [f('module', 'module', true)] },
  rescue: { name: 'rescue', about: 'Failed renewals and the fix ready for each.', fields: [] },
  safety: { name: 'safety', about: 'The safety record: what was stopped and whether the record is intact.', fields: [] },
  book: { name: 'book', about: 'The deals as a list; module and fate narrow it.', fields: [f('module', 'module', true), f('fate', 'fate', true)] },
  week: { name: 'week', about: 'The week replayed from the record.', fields: [] },
  setup: { name: 'setup', about: 'The first-run steps and which are done.', fields: [] },
};

export const ACTIONS: Record<ActionRef['action'], EntryDef> = {
  open_decision: { name: 'open_decision', about: 'A button that opens the approval window on this deal. She decides there; you cannot.', fields: [f('deal_id', 'deal_id')] },
  open_setup: { name: 'open_setup', about: 'A button that opens one setup step in the approval window.', fields: [f('target', 'setup_target')] },
  open_console: { name: 'open_console', about: 'A button that opens a page of the full console.', fields: [f('hash', 'hash')] },
  pause_agents: { name: 'pause_agents', about: 'A button that pauses all her agents after she confirms it: their work stops and nothing new starts. Nothing is paid or cancelled, and she can undo it. Propose it only when she asks to stop or pause her agents.', fields: [] },
  pause_agent: { name: 'pause_agent', about: 'A button that pauses one of her agents after she confirms it: the negotiator haggles at her tables, the shopper makes agent purchases, the assistant reads the book and drafts work. Its work stops; nothing is paid or cancelled, and she can undo it. Propose it only when she asks to stop or pause that agent.', fields: [f('agent', 'agent')] },
  let_lapse: { name: 'let_lapse', about: 'A button that, after she confirms it, leaves one deal that needs her to lapse at its deadline, exactly as if she did nothing: no money moves, nothing is agreed or cancelled early, and she can undo it before the deadline. Propose it only when she says she does not want that deal.', fields: [f('deal_id', 'deal_id')] },
};

/** What pressing an action does. `handoff`: opens the approval window or a console page, changes
 *  nothing. `act`: changes the wallet in a small reversible way, only after the owner's explicit
 *  press on a consent box the host draws from its own data. The command an act runs is chosen by the
 *  host (windows/main/switchboard/resolve.ts), never named here or by the assistant. */
export type ActionClass = 'handoff' | 'act';
export const ACTION_CLASS: Record<ActionRef['action'], ActionClass> = {
  open_decision: 'handoff',
  open_setup: 'handoff',
  open_console: 'handoff',
  pause_agents: 'act',
  pause_agent: 'act',
  let_lapse: 'act',
};

export const OPS: Record<UiOp['op'], EntryDef> = {
  show: { name: 'show', about: 'Put an answer panel in the answer area (replaces the current one).', fields: [f('panel', 'panel')] },
  focus: { name: 'focus', about: 'Light up a module row, a fate column or a deal on the board. Hides nothing.', fields: [f('module', 'module', true), f('fate', 'fate', true), f('deal_id', 'deal_id', true)] },
  filter: { name: 'filter', about: 'Dim everything that is not this module and/or fate. Both null clears it.', fields: [f('module', 'module', true), f('fate', 'fate', true)] },
  propose: { name: 'propose', about: 'A proposal button; why is one plain sentence saying what it does and what happens if she does nothing.', fields: [f('action', 'action'), f('why', 'why')] },
};

const OP_KEYS = Object.keys(OPS) as UiOp['op'][];
const ACTION_KEYS = Object.keys(ACTIONS) as ActionRef['action'][];

const HASH_WORDS = `#m=<module>, #d=<deal_id>, #p=<${CONSOLE_PLACES.join('|')}>, #s=setup, #w=waiting, #r=rewind`;

function kindText(d: FieldDef): string {
  const n = d.nullable ? '|null' : '';
  switch (d.kind) {
    case 'module': return `module${n}`;
    case 'fate': return `fate${n}`;
    case 'deal_id': return `deal_id${n}`;
    case 'hash': return 'hash';
    case 'setup_target': return `target (${SETUP_TARGETS.join('|')})`;
    case 'agent': return `agent (${AGENT_SLOTS.join('|')})`;
    case 'why': return `why (plain text, up to ${WHY_MAX} characters)`;
    case 'panel': return 'panel';
    case 'action': return 'action';
  }
}

function line(e: EntryDef): string {
  const fields = e.fields.map((d) => `${d.name}: ${kindText(d)}`).join(', ');
  return `- ${e.name}${fields ? ` (${fields})` : ''}: ${e.about}`;
}

/** Plain-text description of every panel kind, op and action, derived from the registry (for the prompt). */
export function describeVocabulary(): string {
  return [
    'Panels (the answers you can show):',
    ...PANEL_KINDS.map((k) => line(PANELS[k])),
    `Ops (what you may do; at most ${OPS_MAX} per reply):`,
    ...OP_KEYS.map((k) => line(OPS[k])),
    'Actions (only inside a propose op; each is a button she may press, never something you do):',
    ...ACTION_KEYS.map((k) => line(ACTIONS[k])),
    `module is one of ${MODULE_KEYS.join('|')}. fate is one of ${FATES.join('|')}. deal_id must be an id that appears in the board data.`,
    `open_console hash is one of: ${HASH_WORDS}.`,
  ].join('\n');
}

type Schema = Record<string, unknown>;

function fieldSchema(d: FieldDef): Schema {
  const orNull = (s: Schema): Schema => (d.nullable ? { anyOf: [s, { type: 'null' }] } : s);
  switch (d.kind) {
    case 'module': return orNull({ type: 'string', enum: [...MODULE_KEYS] });
    case 'fate': return orNull({ type: 'string', enum: [...FATES] });
    case 'deal_id': return orNull({ type: 'string', minLength: 1, maxLength: DEAL_ID_MAX });
    case 'hash': return { type: 'string', pattern: HASH_RE.source, maxLength: 40 };
    case 'setup_target': return { type: 'string', enum: [...SETUP_TARGETS] };
    case 'agent': return { type: 'string', enum: [...AGENT_SLOTS] };
    case 'why': return { type: 'string', minLength: 1, maxLength: WHY_MAX };
    case 'panel': return { anyOf: PANEL_KINDS.map((k) => entrySchema('kind', PANELS[k])) };
    case 'action': return { anyOf: ACTION_KEYS.map((k) => entrySchema('action', ACTIONS[k])) };
  }
}

function entrySchema(tag: 'kind' | 'op' | 'action', e: EntryDef): Schema {
  return {
    type: 'object',
    description: e.about,
    additionalProperties: false,
    required: [tag, ...e.fields.map((d) => d.name)],
    properties: { [tag]: { const: e.name }, ...Object.fromEntries(e.fields.map((d) => [d.name, fieldSchema(d)])) },
  };
}

/** JSON Schema of an AssistantReply, derived from the registry (passed to the CLI as --json-schema). */
export function replyJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['v', 'say', 'ops'],
    properties: {
      v: { const: ASSISTANT_V },
      say: { type: 'string', maxLength: SAY_MAX },
      ops: { type: 'array', maxItems: OPS_MAX, items: { anyOf: OP_KEYS.map((k) => entrySchema('op', OPS[k])) } },
    },
  };
}
