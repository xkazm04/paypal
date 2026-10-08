// "What you were shown": on a deal that ended at its deadline, the rungs of the attention ladder the
// owner was actually offered before the default ran, from the wallet's own record (deal_history:
// the safe default's step carries the rungs it cites, attention-ladder-1). Pure: no React, no IPC.
// "Lapsed 18:00 · shown 16:02 · notified 17:45 · opened 17:50 · no money moved". Times are local;
// a time on another day than the ending carries its weekday. Never ids, never the other side's words.
import type { HistoryKind } from '@bindings/HistoryKind';
import type { HistoryStep } from '@bindings/HistoryStep';
import type { LadderRung } from '@bindings/LadderRung';
import type { RungMark } from '@bindings/RungMark';
import { NEVER_SHOWN, NOT_NOTIFIED_BECAUSE } from '../../../lib/words';

/** How a deadline's safe default ended the deal, and what it did to the money. */
const ENDING: Partial<Record<HistoryKind, readonly [string, string]>> = {
  lapsed: ['Lapsed', 'no money moved'],
  expired: ['Expired', 'no money moved'],
  auto_voided: ['Hold released', 'nothing was paid'],
};

/** The deal's ending under the safe default, when it cites what the owner was shown. */
export function shownStep(steps: readonly HistoryStep[]): HistoryStep | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i]!;
    if (s.authority.type === 'safe_default' && ENDING[s.kind] && s.rungs != null) return s;
  }
  return null;
}

const two = (n: number) => String(n).padStart(2, '0');
const hm = (d: Date) => `${two(d.getHours())}:${two(d.getMinutes())}`;
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const weekday = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'short' });

/** "16:02" on the same local day as `ref`, "Mon 16:02" on another. */
export function shownTime(unix: number, ref: number): string {
  const d = new Date(unix * 1000);
  return sameDay(d, new Date(ref * 1000)) ? hm(d) : `${weekday(d)} ${hm(d)}`;
}

const first = (rungs: readonly RungMark[], ...kinds: LadderRung[]) => rungs.find((m) => kinds.includes(m.rung)) ?? null;

/**
 * The strip's parts in reading order: the ending and its time, then what the owner was offered in the
 * order it happened (shown, snoozed, notified or why not, opened), then what happened to the money.
 * `now` places the ending: today's ending shows only its time.
 */
export function shownParts(step: HistoryStep, now: number): string[] {
  const [ending, money] = ENDING[step.kind] ?? ['Ended', 'no money moved'];
  const rungs = step.rungs ?? [];
  const head = `${ending} ${shownTime(step.at, now)}`;
  if (!rungs.length) return [head, NEVER_SHOWN, money];
  const at = (unix: number) => shownTime(unix, step.at);
  const lines: Array<{ at: number; text: string }> = [];
  const shown = first(rungs, 'shown');
  if (shown) lines.push({ at: shown.at, text: `shown ${at(shown.at)}` });
  const snoozed = first(rungs, 'snoozed');
  if (snoozed) lines.push({ at: snoozed.at, text: `snoozed ${at(snoozed.at)}` });
  const notified = first(rungs, 'notified');
  const held = first(rungs, 'notify_suppressed');
  if (notified) lines.push({ at: notified.at, text: `notified ${at(notified.at)}` });
  else if (held) lines.push({ at: held.at, text: `not notified: ${NOT_NOTIFIED_BECAUSE[held.reason ?? 'not_shown']}` });
  const opened = first(rungs, 'card_opened', 'review_opened');
  if (opened) lines.push({ at: opened.at, text: `opened ${at(opened.at)}` });
  lines.sort((a, b) => a.at - b.at);
  return [head, ...lines.map((l) => l.text), money];
}
