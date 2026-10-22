// The stale banner under the top bar: shown when one of the World's reads (settings, the ledger,
// what needs you, the agents, the deal names) failed on its last try. It says which part, in the
// owner's words, and the "if you do nothing" line (shared/boundary/staleBanner.ts); "Try again"
// reads those parts again and does nothing else. Never a code, a command or an error's own text.
import { useState } from 'react';
import { BOUNDARY_RETRY, BOUNDARY_RETRYING, joinWords } from '../../../lib/words';
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
  const [trying, setTrying] = useState(false);
  // The live region is always there (an empty one takes no room), so the banner's words are announced
  // when a read fails, not only drawn.
  if (!banner) return <div className="cs-stale-live" role="status" aria-live="polite" />;
  const retry = () => {
    if (trying) return;
    setTrying(true);
    const reads: Promise<unknown>[] = [];
    for (const q of [settings, deals, attention, runs]) if (q.error) reads.push(q.refetch());
    // The deal names (deal_display) that failed are read again too; nothing else.
    reads.push(client.refetchQueries({ predicate: (q) => q.state.status === 'error' }));
    // A button that is working says so until every one of those reads has answered, well or not.
    void Promise.allSettled(reads).then(() => setTrying(false));
  };
  return (
    <div className="cs-stale-live" role="status" aria-live="polite">
      <div className={`cs-stale ${banner.kind}`}>
        <b>{banner.title}</b>
        {banner.parts.length ? <span className="parts">{joinWords(banner.parts)}</span> : null}
        <span>{banner.text}</span>
        <Btn sm onClick={retry} disabled={trying} aria-busy={trying}>{trying ? BOUNDARY_RETRYING : BOUNDARY_RETRY}</Btn>
      </div>
    </div>
  );
}
