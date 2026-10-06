// The six modules - names, colours, one-line purpose and their small engraved glyphs, ported
// verbatim from the winning prototype (prototype/main/modules.js). Shared by every window so a
// module looks the same on the Dial, in the Tumbler and in the approval window.
import type { Module } from '@bindings/Module';

export type ModuleMeta = {
  key: Module;
  name: string;
  long: string;
  /** Hex for SVG art drawn in a fixed (dark) palette: the Dial, the Tumbler. */
  /** Theme-aware CSS colour, `var(--m-<key>)` (tokens.css). Use this for --mc in pages. */
  cssVar: string;
  week: string;
  cap: number;
  line: string;
  decision: string;
};

export const MODULES: readonly ModuleMeta[] = [
  { key: 'tables', cssVar: 'var(--m-tables)', name: 'Tables', long: 'Haggling', week: 'Mon', cap: 9,
    line: 'Your agent bargains with another wallet’s agent, never past the price range you signed.',
    decision: 'Set the price range: the most you’ll pay, or the least you’ll accept.' },
  { key: 'spend', cssVar: 'var(--m-spend)', name: 'Spend', long: 'Agent purchases', week: 'Tue', cap: 1,
    line: 'Every purchase an agent asks for is checked against your rules first. Money is held, then paid or released.',
    decision: 'Pay or release a hold within 3 days. Doing nothing releases it.' },
  { key: 'counter', cssVar: 'var(--m-counter)', name: 'Counter', long: 'Your shop', week: 'Thu', cap: 3,
    line: 'Other people’s agents can buy from your shop. Your lowest prices are rules you signed.',
    decision: 'Set the lowest price per item. Your agent never quotes below it.' },
  { key: 'book', cssVar: 'var(--m-book)', name: 'Book', long: 'All payments', week: 'Sun', cap: 5,
    line: 'Every deal, its PayPal proof, and whether PayPal’s statement agrees yet.',
    decision: 'Ask a question about your money. Answers only read, never change anything.' },
  { key: 'shield', cssVar: 'var(--m-shield)', name: 'Shield', long: 'Scam checks', week: 'Wed', cap: 7,
    line: 'Every new payee is checked before any money moves. A check can stop a payment, never approve one.',
    decision: 'Release a paused payment by typing the payee’s name, or leave it paused. A block cannot be released.' },
  { key: 'rescue', cssVar: 'var(--m-rescue)', name: 'Rescue', long: 'Failed renewals', week: 'Fri', cap: 8,
    line: 'When a subscriber’s renewal fails, pick one fix for that one subscriber. Never a price change for everyone.',
    decision: 'Approve a fix: it sends one PayPal invoice and drafts your email.' },
];

export const MODULE: Record<Module, ModuleMeta> = Object.fromEntries(MODULES.map((m) => [m.key, m])) as Record<Module, ModuleMeta>;

/** Static, trusted SVG markup (no user data ever reaches these strings). */
function glyphMarkup(key: Module): string {
  // Tokens only (tokens.css): the module colour as var(--m-<key>), gold and the two sides.
  const c = MODULE[key].cssVar;
  const g = 'var(--gold)';
  switch (key) {
    case 'tables': return `<path d="M8 40c6-10 12-14 18-14" stroke="var(--teal)" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M56 40c-6-10-12-14-18-14" stroke="var(--coral)" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="32" cy="26" r="7" fill="${g}"/><path d="M6 48h52" stroke="${c}" stroke-width="3" stroke-linecap="round"/><path d="M14 48v8M50 48v8" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`;
    case 'spend': return `<path d="M10 56V22a22 14 0 0 1 44 0v34" fill="none" stroke="${c}" stroke-width="3.5"/><path d="M20 20v36M32 13v43M44 20v36M10 34h44M10 46h44" stroke="${c}" stroke-width="2.4" opacity=".75"/><rect x="26" y="38" width="12" height="9" rx="2" fill="${g}"/>`;
    case 'counter': return `<path d="M6 44h52v6H6z" fill="${c}"/><path d="M10 50v8M54 50v8" stroke="${c}" stroke-width="3"/><path d="M22 40a10 10 0 0 1 20 0z" fill="none" stroke="${c}" stroke-width="3"/><circle cx="32" cy="27" r="2.6" fill="${c}"/><path d="M14 12h36l-4 10H18z" fill="none" stroke="${c}" stroke-width="2.4" opacity=".7"/>`;
    case 'book': return `<path d="M32 16c-8-5-16-6-24-5v38c8-1 16 0 24 5 8-5 16-6 24-5V11c-8-1-16 0-24 5z" fill="none" stroke="${c}" stroke-width="3"/><path d="M32 16v38" stroke="${c}" stroke-width="2"/><path d="M14 22h12M14 29h12M14 36h9M38 22h12M38 29h8M38 36h12" stroke="${c}" stroke-width="2" opacity=".7"/><circle cx="46" cy="43" r="3" fill="${g}"/>`;
    case 'shield': return `<path d="M32 6v6" stroke="${c}" stroke-width="3"/><path d="M22 14h20l4 8v22l-4 8H22l-4-8V22z" fill="none" stroke="${c}" stroke-width="3"/><path d="M32 24c5 6 6 10 0 18-6-8-5-12 0-18z" fill="${c}" opacity=".9"/><path d="M14 58h36" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`;
    case 'rescue': return `<circle cx="32" cy="32" r="19" fill="none" stroke="${c}" stroke-width="9" stroke-dasharray="14.9 14.9"/><circle cx="32" cy="32" r="19" fill="none" stroke="${c}" stroke-width="1.5" opacity=".6"/><path d="M48 50c6 4 8 8 8 10" stroke="${g}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
  }
}

/** A module's small engraved glyph (64x64 viewBox). */
export function Glyph({ module, className, title }: { module: Module; className?: string; title?: string }) {
  return (
    <svg className={className ?? 'glyph'} viewBox="0 0 64 64" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}
      dangerouslySetInnerHTML={{ __html: glyphMarkup(key(module)) }} />
  );
}
const key = (m: Module) => m;
