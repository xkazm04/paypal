import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatHash, parseHash, PLACES, PREVIEW_PLACES } from '../../windows/main/logic';
import { FATES, MODULE_KEYS, PANEL_KINDS, type ActionRef, type UiOp } from './contract';
import { ACTION_CLASS, ACTIONS, AGENT_SLOTS, CONSOLE_PLACES, HASH_RE, OPS, PANELS, SETUP_TARGETS, describeVocabulary, replyJsonSchema } from './vocabulary';

// The compile-time half of parity: adding an op or action to contract.ts without listing it here is a type error.
const ALL_OPS: Record<UiOp['op'], true> = { show: true, focus: true, filter: true, propose: true };
const ALL_ACTIONS: Record<ActionRef['action'], true> = { open_decision: true, open_setup: true, open_console: true, pause_agents: true, pause_agent: true, let_lapse: true };

const json = (v: unknown): string => JSON.stringify(v);

describe('registry parity with the contract', () => {
  it('has an entry for every panel kind, op and action, and no extra', () => {
    expect(Object.keys(PANELS).sort()).toEqual([...PANEL_KINDS].sort());
    expect(Object.keys(OPS).sort()).toEqual(Object.keys(ALL_OPS).sort());
    expect(Object.keys(ACTIONS).sort()).toEqual(Object.keys(ALL_ACTIONS).sort());
    for (const k of PANEL_KINDS) expect(PANELS[k].name).toBe(k);
  });

  it('the schema mentions every panel kind, op, action, module and fate', () => {
    const s = json(replyJsonSchema());
    for (const k of PANEL_KINDS) expect(s).toContain(`"const":"${k}"`);
    for (const k of Object.keys(ALL_OPS)) expect(s).toContain(`"const":"${k}"`);
    for (const k of Object.keys(ALL_ACTIONS)) expect(s).toContain(`"const":"${k}"`);
    for (const m of MODULE_KEYS) expect(s).toContain(`"${m}"`);
    for (const f of FATES) expect(s).toContain(`"${f}"`);
  });

  it('the schema has the reply limits', () => {
    const s = replyJsonSchema() as { properties: { v: { const: number }; say: { maxLength: number }; ops: { maxItems: number; items: { anyOf: unknown[] } } } };
    expect(s.properties.v.const).toBe(1);
    expect(s.properties.say.maxLength).toBe(600);
    expect(s.properties.ops.maxItems).toBe(8);
    expect(s.properties.ops.items.anyOf).toHaveLength(4);
  });

  it('the description names every entry', () => {
    const t = describeVocabulary();
    for (const k of [...PANEL_KINDS, ...Object.keys(ALL_OPS), ...Object.keys(ALL_ACTIONS)]) expect(t).toContain(`- ${k}`);
  });

  it('is deterministic', () => {
    expect(json(replyJsonSchema())).toBe(json(replyJsonSchema()));
    expect(describeVocabulary()).toBe(describeVocabulary());
  });
});

describe('no action can decide or take free text (B3)', () => {
  it('action names and fields carry no decision command', () => {
    const forbidden = ['approve', 'sign', 'capture', 'void', 'release', 'pay', 'countersign'];
    for (const a of Object.values(ACTIONS)) {
      for (const c of forbidden) expect(a.name).not.toContain(c);
      for (const d of a.fields) expect(['deal_id', 'setup_target', 'hash', 'agent']).toContain(d.kind);
    }
    expect(Object.keys(ACTIONS).sort()).toEqual(['let_lapse', 'open_console', 'open_decision', 'open_setup', 'pause_agent', 'pause_agents']);
  });
  it('every action has a class; the acts are the three that make the wallet do less, each with a typed target only', () => {
    expect(Object.keys(ACTION_CLASS).sort()).toEqual(Object.keys(ALL_ACTIONS).sort());
    const acts = Object.entries(ACTION_CLASS).filter(([, c]) => c === 'act').map(([a]) => a).sort();
    expect(acts).toEqual(['let_lapse', 'pause_agent', 'pause_agents']);
    expect(ACTIONS.pause_agents.fields).toEqual([]);
    expect(ACTIONS.pause_agent.fields.map((d) => [d.name, d.kind, d.nullable])).toEqual([['agent', 'agent', false]]);
    expect(ACTIONS.let_lapse.fields.map((d) => [d.name, d.kind, d.nullable])).toEqual([['deal_id', 'deal_id', false]]);
    // no undo is proposable
    for (const undo of ['resume_agents', 'resume_agent', 'lapse_undo', 'resume_all', 'undo']) expect(Object.keys(ACTIONS)).not.toContain(undo);
  });
  it('the agent field is the three agent slots', () => {
    expect([...AGENT_SLOTS]).toEqual(['negotiator', 'shopper', 'assistant']);
    expect(JSON.stringify(replyJsonSchema())).toContain('"agent":{"type":"string","enum":["negotiator","shopper","assistant"]}');
  });
  it('the schema of an act admits no extra key', () => {
    const s = JSON.stringify(replyJsonSchema());
    expect(s).toContain('{"type":"object","description":"' + ACTIONS.pause_agents.about + '","additionalProperties":false,"required":["action"],"properties":{"action":{"const":"pause_agents"}}}');
  });
  it('the vocabulary text names no wallet command, not even the one an act runs', () => {
    const t = describeVocabulary();
    for (const c of ['pause_all_agents', 'resume_all_agents', 'deal_let_lapse', 'deal_withdraw', 'agent_start']) expect(t).not.toContain(c);
  });
  it('setup targets are the three hand-off steps only', () => {
    expect([...SETUP_TARGETS]).toEqual(['credentials', 'mandate', 'unlock']);
  });
  it('the vocabulary text carries no decision command', () => {
    const t = describeVocabulary();
    for (const c of ['deal_countersign', 'deal_capture', 'deal_void', 'shield_release', 'rescue_approve', 'mandate_sign', 'envelope_sign']) expect(t).not.toContain(c);
  });
});

describe('the hash grammar is a subset of what parseHash round-trips', () => {
  const hashes = [...MODULE_KEYS.map((m) => `#m=${m}`), ...CONSOLE_PLACES.map((p) => `#p=${p}`), '#d=D-0193', '#s=setup', '#w=waiting', '#r=rewind'];
  it('every accepted hash parses to a route that formats back to itself', () => {
    for (const h of hashes) {
      expect(HASH_RE.test(h)).toBe(true);
      const { route } = parseHash(h);
      expect(route.level).not.toBe('home');
      // setup parses with its default step appended; every other form is exact
      expect(formatHash(route).startsWith(h)).toBe(true);
    }
  });
  it('places match the console places minus the preview-only ones', () => {
    expect([...CONSOLE_PLACES].sort()).toEqual(PLACES.filter((p) => !PREVIEW_PLACES.includes(p)).sort());
  });
  it('rejects everything else', () => {
    for (const h of ['javascript:alert(1)', '#p=director', '#m=nope', '#d=', '#d=a b', '#m=shield&v=x', '#x=1', 'https://x.example/', '#d=../x', '']) expect(HASH_RE.test(h)).toBe(false);
  });
});

describe('prompt.ts and vocabulary.ts load in Node (B6)', () => {
  for (const file of ['prompt.ts', 'vocabulary.ts', 'digest.ts', 'validate.ts']) {
    it(`${file} imports only lib/assistant and @bindings types`, () => {
      const src = readFileSync(join(process.cwd(), 'src', 'lib', 'assistant', file), 'utf8');
      const specs = [...src.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1] as string);
      expect(specs.length).toBeGreaterThan(0);
      for (const s of specs) expect(s.startsWith('./') || s.startsWith('@bindings/')).toBe(true);
      expect(src).not.toMatch(/\b(?:window|document)\.[a-zA-Z]|from ['"]react/);
    });
  }
});
