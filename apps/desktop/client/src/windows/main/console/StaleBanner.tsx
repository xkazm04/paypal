// The stale banner under the top bar: shown when one of the World's reads (settings, the ledger,
// what needs you, the agents, the deal names) failed on its last try. It says which part, in the
// owner's words, and the "if you do nothing" line (shared/boundary/staleBanner.ts); "Try again"
// reads those parts again and does nothing else. Never a code, a command or an error's own text.
import { BOUNDARY_RETRY, joinWords } from '../../../lib/words';
import { useDataClient } from '../../../lib/data/provider';
import { Btn } from '../../../shared/ui';
import { useAttention, useDeals, useRuns, useSettings, useStaleBanner } from '../world';

export function StaleBanner() {
  const banner = useStaleBanner();
  const settings = useSettings();
  const deals = useDeals();
  const attention = useAttention();
  const runs = useRuns();
  const client = useDataClient();
  if (!banner) return null;
  const retry = () => {
    for (const q of [settings, deals, attention, runs]) if (q.error) void q.refetch();
    // The deal names (deal_display) that failed are read again too; nothing else.
    void client.refetchQueries({ predicate: (q) => q.state.status === 'error' });
  };
  return (
    <div className={`cs-stale ${banner.kind}`} role="status">
      <b>{banner.title}</b>
      {banner.parts.length ? <span className="parts">{joinWords(banner.parts)}</span> : null}
      <span>{banner.text}</span>
      <Btn sm onClick={retry}>{BOUNDARY_RETRY}</Btn>
    </div>
  );
}
