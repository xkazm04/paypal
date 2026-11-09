// "Cut off a wallet" on Connections › Who you deal with. Cutting a wallet off is an owner decision
// that only the approval window can make (approval label, its token, unlocked, held), so this button
// never asks the wallet to cut anyone off: it opens the approval window on owner configuration, whose
// Connections section lists the connected wallets, each with its own held "Cut off".
import type { CounterpartyDisplay } from '@bindings/CounterpartyDisplay';
import { CONNECTIONS_PEOPLE } from '../../../../../lib/words';
import { ToApproval } from '../settings/handoff';

/** Shown once any wallet is pinned (there is someone to cut off). */
export function CutOffHandoff({ list }: { list: readonly CounterpartyDisplay[] | null }) {
  if (!list?.some((c) => c.pairing !== 'unpaired')) return null;
  return <ToApproval label={CONNECTIONS_PEOPLE.cutOff} kind="default" sm title={CONNECTIONS_PEOPLE.cutOffTitle} />;
}
