// Small pieces shared by the setup sheet's three tabs: the hand-off to the approval window, the
// "who may set this" chip, an ⓘ button that opens a Popover, and chips from the pure Circuit tones.
import { useState, type ReactNode } from 'react';
import type { H256 } from '@bindings/H256';
import { WalletNotice } from '../../../shared/honesty';
import { Btn, Chip, Popover, useToast, type BtnKind } from '../../../shared/ui';
import { useMutation } from '../../../lib/hooks';
import type { Tone, Who } from './circuit';

/** Opens the approval window (the only surface that stores credentials, signs mandates, unlocks
 *  and confirms pairing words). Main never does those acts itself. While idle-locked the button
 *  carries the lock glyph: the approval window asks for Windows Hello first. */
export function Handoff({ label, kind = 'gold', sm = true, locked, pairing, target, title, onOpened }: {
  label: ReactNode; kind?: BtnKind; sm?: boolean; locked: boolean; pairing?: H256; target?: 'credentials' | 'mandate' | 'unlock'; title?: string; onOpened?: () => void;
}) {
  const open = useMutation('approval_open');
  const toast = useToast();
  const go = async () => {
    const r = await open.run(pairing ? { deal_id: null, pairing } : { deal_id: null, target: target ?? null });
    if (r === null) {
      toast(locked ? <>Approval window opened · <b>unlock with Windows Hello</b> there first</> : 'Approval window opened · owner configuration', 'gold');
      onOpened?.();
    }
  };
  return (
    <>
      <Btn kind={kind} sm={sm} locked={locked} disabled={open.pending} onClick={() => void go()}
        title={title ?? (locked ? 'Idle-locked: the approval window asks for Windows Hello first' : 'Opens the approval window')}>
        {label} ↗
      </Btn>
      {open.error ? <WalletNotice error={open.error} what="Approval window" /> : null}
    </>
  );
}

export function WhoChip({ who, locked }: { who: Who; locked?: boolean }) {
  if (who === 'only-you') return <Chip tone="gold" title={`Only you, in the approval window${locked ? ' · locked: Windows Hello first' : ''}`}>{locked ? '◆ ' : ''}only you</Chip>;
  if (who === 'you') return <Chip tone="teal" title="You, here in The Table">you</Chip>;
  return <Chip tone="dashed" title="Fixed: nobody can change it">fixed</Chip>;
}

export function ToneChip({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return <Chip tone={tone === 'plain' ? undefined : tone} title={title}>{children}</Chip>;
}

/** A small button that toggles a Popover with Layer-2 detail. */
export function Info({ label, title, children, text = 'ⓘ', className }: { label: string; title?: ReactNode; children: ReactNode; text?: ReactNode; className?: string }) {
  const [a, setA] = useState<HTMLElement | null>(null);
  return (
    <>
      <Btn kind="plain" sm aria-label={label} title={label} aria-expanded={!!a} onClick={(e) => { const t = e.currentTarget; setA((x) => (x ? null : t)); }}>{text}</Btn>
      {a ? <Popover anchor={a} onClose={() => setA(null)} title={title ?? label} className={`setup-pop ${className ?? ''}`}>{children}</Popover> : null}
    </>
  );
}
