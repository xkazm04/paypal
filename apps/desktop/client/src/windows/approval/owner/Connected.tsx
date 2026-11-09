// Connected wallets and cutting one off (owner configuration › Connections). Cutting off is an owner
// decision: only this window may ask for it (approval label, its token, unlocked), and it takes the
// hold gesture, never a bare click. The wallet's rule (table-ledger pin.rs, Runtime's revoke): the
// pin is marked revoked, never deleted; every message that wallet signs is refused from then on; open
// deals with it are not closed, they end by their own deadline or by the owner's decision. Nothing
// here moves money.
//
// After a revoke the wallet emits no event that covers the counterparty list, so the caller reads it
// again (`onChanged`). The wallet then lists that key as unpaired under a fixed name; the wallets cut
// off in this window keep their name and read "cut off" here for as long as the window is open.
import { useState, useSyncExternalStore } from 'react';
import type { CounterpartyDisplay } from '@bindings/CounterpartyDisplay';
import type { WalletError } from '../../../lib/contract';
import { shortId } from '../../../lib/format';
import { APPROVAL_CUT_OFF as W, houseWords } from '../../../lib/words';
import { WalletNotice } from '../../../shared/honesty';
import { Btn, Chip, Group, HoldButton, Kv, Row, Sheet } from '../../../shared/ui';
import { useSession } from '../session';

/** A key's short form: enough to tell two keys apart by eye, never the whole id. */
export const keyShort = (key: string): string => shortId(key, 6, 4);

// ---- the wallets cut off in this window (name kept: the wallet's list drops it) ------------------
let cut: ReadonlyMap<string, string> = new Map();
const subs = new Set<() => void>();
const subscribe = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; };
function markCut(key: string, name: string): void {
  cut = new Map(cut).set(key, name);
  subs.forEach((s) => s());
}
/** Tests only. */
export function resetCut(): void {
  cut = new Map();
  subs.forEach((s) => s());
}
const useCut = () => useSyncExternalStore(subscribe, () => cut, () => cut);

type Listed = { c: CounterpartyDisplay; name: string; state: 'connected' | 'cut' };

/** The wallets this page lists: every pinned one, and every one cut off here (even once the wallet
 *  lists it as unpaired). A key never confirmed has no pin to cut, so it is not listed. */
export function listed(list: readonly CounterpartyDisplay[], cutOff: ReadonlyMap<string, string>): Listed[] {
  return list.flatMap((c): Listed[] => {
    const was = cutOff.get(c.key_id);
    if (was !== undefined) return [{ c, name: was, state: 'cut' }];
    return c.pairing === 'unpaired' ? [] : [{ c, name: houseWords(c.display_name), state: 'connected' }];
  });
}

/** The one row on the owner page: how many are connected, and the way in. */
export function ConnectedRow({ list, error, onOpen }: { list: readonly CounterpartyDisplay[] | undefined; error: WalletError | null; onOpen: () => void }) {
  const cutOff = useCut();
  const rows = list ? listed(list, cutOff) : [];
  const live = rows.filter((r) => r.state === 'connected').length;
  const gone = rows.length - live;
  if (!list) {
    return <Row title={W.row} sub={error ? W.unread : W.reading}><Chip tone="dashed">{error ? W.unreadChip : W.readingChip}</Chip></Row>;
  }
  return (
    <Row title={W.row} sub={`${W.rowSub(live)}${gone ? ` · ${W.rowCut(gone)}` : ''}`}>
      <Btn sm aria-label={W.manageLabel} onClick={onOpen} disabled={rows.length === 0}>{W.manage}</Btn>
    </Row>
  );
}

const sinceLabel = (unix: number) => new Date(unix * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** The list, each with its own "Cut off…", and the one confirmation the owner holds. */
export function ConnectedSheet({ list, locked, onClose, onChanged }: {
  list: readonly CounterpartyDisplay[]; locked: boolean; onClose: () => void; onChanged: () => void;
}) {
  const s = useSession();
  const cutOff = useCut();
  const rows = listed(list, cutOff);
  const [asking, setAsking] = useState<Listed | null>(null);
  const [error, setError] = useState<WalletError | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const busy = s.pending !== null || s.unlocking;
  const cutting = s.pending === 'counterparty_revoke';

  const confirm = async (who: Listed) => {
    setError(null);
    const r = await s.call('counterparty_revoke', { key_id: who.c.key_id }, true);
    if (!r.ok) { setError(r.error); setAttempts((n) => n + 1); return; }
    markCut(who.c.key_id, who.name);
    setDone(W.done(who.name));
    setAsking(null);
    onChanged();
  };

  if (asking) {
    const key = keyShort(asking.c.key_id);
    const footer = (
      <>
        <Btn className="left" disabled={cutting} onClick={() => { setAsking(null); setError(null); }}>{W.keep}</Btn>
        {locked ? (
          <Btn kind="gold" locked disabled={!s.tokenReady || busy} title={W.lockedWhy} onClick={() => void s.unlock()}>{s.unlocking ? W.unlocking : W.unlock}</Btn>
        ) : (
          // A fresh gesture after each refusal: the hold can be held again even when the answer came
          // back before the busy state was ever drawn. Gold, the window's hold plate: the light theme
          // paints every hold plate gold, so a red (danger) label would not read on it.
          <HoldButton key={attempts} kind="gold" disabled={!s.tokenReady || busy} hint={W.holdHint} onConfirm={() => void confirm(asking)}>
            {cutting ? W.cutting : W.hold(asking.name)}
          </HoldButton>
        )}
      </>
    );
    return (
      <Sheet title={W.ask(asking.name)} onClose={onClose} footer={footer} className="ow-lim-sheet ow-cut">
        <Kv items={[
          [W.who, asking.name],
          [W.key, <span className="mono">{key}</span>],
          [W.stops, W.stopsWhat],
          [W.open, W.openWhat],
          [W.after, W.afterWhat],
        ]} />
        <p className="ow-p">{W.money}</p>
        {locked ? <p className="ow-p">{W.lockedWhy}</p> : null}
        {error ? <WalletNotice error={error} what={W.failed} /> : null}
      </Sheet>
    );
  }

  return (
    <Sheet title={W.sheet} onClose={onClose} className="ow-lim-sheet ow-cut">
      <p className="ow-p">{W.intro}</p>
      {done ? <p className="ow-p ow-cut-done" role="status">{done}</p> : null}
      <Group empty={W.none}>
        {rows.map((r) => {
          const key = keyShort(r.c.key_id);
          return (
            <Row key={r.c.key_id} title={r.name} sub={W.line(key, sinceLabel(r.c.first_seen), W.deals(r.c.deals_closed))}>
              {r.state === 'cut' ? <Chip tone="line">{W.cutOff}</Chip> : (
                <>
                  <Chip tone="ok">{W.connected}</Chip>
                  <Btn sm kind="danger" disabled={busy} aria-label={W.actLabel(r.name, key)} onClick={() => { setDone(null); setError(null); setAsking(r); }}>{W.act}</Btn>
                </>
              )}
            </Row>
          );
        })}
      </Group>
    </Sheet>
  );
}
