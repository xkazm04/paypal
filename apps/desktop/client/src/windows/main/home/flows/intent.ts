// Which flow a line typed in the ask box starts, if any (spark chat-configure). Slash commands are
// exact; plain words are matched on a few stems per flow and only when the line is short and reads as
// a request to CHANGE or SHOW the thing, so a question ("why was the rule broken?") still goes to the
// assistant. Pure: no React, no IO.
import type { FlowKind } from './store';

export const SLASH: Readonly<Record<string, FlowKind>> = { '/rules': 'rules', '/limits': 'rules', '/settings': 'settings', '/connect': 'connections', '/connections': 'connections', '/rewind': 'rewind', '/replay': 'rewind' };

const STEMS: ReadonlyArray<readonly [FlowKind, RegExp]> = [
  ['rules', /\b(change|set|raise|lower|update|edit)\b.*\b(limit|limits|rule|rules|cap)\b/i],
  ['settings', /\b(change|set|turn|switch|pause|resume|mute|quiet)\b.*\b(setting|settings|theme|dark|light|alert|alerts|notification|notifications|agents?)\b/i],
  ['connections', /\b(connect|pair|join|add)\b.*\b(shop|wallet|seller|agent app|engine|connection|connections)\b/i],
  ['rewind', /\b(replay|rewind|go back to|show me)\b.*\b(day|days|yesterday|tuesday|monday|wednesday|thursday|friday|saturday|sunday|last week|week)\b/i],
];

/** The flow a typed line starts, or null (the line then goes to the assistant as before). */
export function matchFlow(text: string): FlowKind | null {
  const t = text.trim();
  if (!t) return null;
  if (t.startsWith('/')) return SLASH[t.toLowerCase().split(/\s+/)[0] ?? ''] ?? null;
  if (t.length > 90 || t.endsWith('?')) return null;
  return STEMS.find(([, re]) => re.test(t))?.[0] ?? null;
}
