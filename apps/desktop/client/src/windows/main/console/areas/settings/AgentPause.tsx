// Pause or resume ONE agent (agent_pause / agent_resume, act tier, main window), beside its row in
// Settings › Your agents. The wallet's rule (table-runtime acts.rs): pausing stops that agent's runs
// now and starts nothing for it until it is resumed; resuming clears the pause and starts nothing by
// itself. Neither moves money. The paused state is read from the settings (paused_agents); the
// wallet's settings:changed event after either command re-reads them, so nothing is patched here.
import type { ReactNode } from 'react';
import type { AgentSlot } from '@bindings/AgentSlot';
import { useMutation } from '../../../../../lib/hooks';
import { SETTINGS_AGENT_ONE } from '../../../../../lib/words';
import { WalletNotice } from '../../../../../shared/honesty';
import { Btn, Chip, useToast } from '../../../../../shared/ui';

/** This agent is paused on its own (SettingsSnapshot.paused_agents; older shells omit the list). */
export function isPausedAlone(slot: AgentSlot, pausedAgents: readonly AgentSlot[] | null | undefined): boolean {
  return !!pausedAgents?.includes(slot);
}

/** The row's end (its state chips, then the control) and, under the row, a refusal in the wallet's
 *  own words. Rendered inside a Settings `st-list` row (a two-column grid). */
export function AgentPause({ slot, paused, known, children }: {
  slot: AgentSlot;
  /** Paused on its own, as the settings say. */
  paused: boolean;
  /** The settings were read: without them the state is unknown and the control waits. */
  known: boolean;
  /** The row's other state chips (busy / idle). */
  children?: ReactNode;
}) {
  const pause = useMutation('agent_pause');
  const resume = useMutation('agent_resume');
  const toast = useToast();
  const busy = pause.pending || resume.pending;
  const run = async () => {
    if (paused) {
      if ((await resume.run({ agent: slot })) === null) toast(SETTINGS_AGENT_ONE.resumedToast(cap(slot)), 'ok');
    } else if ((await pause.run({ agent: slot })) === null) toast(SETTINGS_AGENT_ONE.pausedToast(cap(slot)), 'gold');
  };
  const failure = paused ? resume.error ?? pause.error : pause.error ?? resume.error;
  return (
    <>
      <span className="st-chips">
        {paused ? <Chip tone="gold">{SETTINGS_AGENT_ONE.paused}</Chip> : children}
        <Btn sm kind={paused ? 'primary' : 'default'} disabled={busy || !known}
          aria-label={paused ? SETTINGS_AGENT_ONE.resumeLabel(slot) : SETTINGS_AGENT_ONE.pauseLabel(slot)}
          title={paused ? SETTINGS_AGENT_ONE.resumeTitle : SETTINGS_AGENT_ONE.pauseTitle}
          onClick={() => void run()}>
          {resume.pending ? SETTINGS_AGENT_ONE.resuming : pause.pending ? SETTINGS_AGENT_ONE.pausing : paused ? SETTINGS_AGENT_ONE.resume : SETTINGS_AGENT_ONE.pause}
        </Btn>
      </span>
      {failure ? (
        <div className="st-fail">
          <WalletNotice error={failure} what={failure === resume.error ? SETTINGS_AGENT_ONE.resumeFailed(cap(slot)) : SETTINGS_AGENT_ONE.pauseFailed(cap(slot))} />
        </div>
      ) : null}
    </>
  );
}

const cap = (t: string): string => `${t.charAt(0).toUpperCase()}${t.slice(1)}`;
