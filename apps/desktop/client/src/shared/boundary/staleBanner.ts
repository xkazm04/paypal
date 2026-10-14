// The stale banner's data contract (the banner itself is drawn in WP2). Pure: from the World's
// health (windows/main/world.tsx WorldHealth, or any read's { data, error }) to what the banner says.
// Never an error code, a command name or the error's own message: only which part, in the owner's
// words, and the "if you do nothing" line.
import type { WalletError } from '../../lib/contract';
import { STALE_PART, STALE_TEXT, STALE_TITLE, UNREAD_TEXT, UNREAD_TITLE } from '../../lib/words';

export type StalePart = keyof typeof STALE_PART;

/** One read's state as the banner needs it: did it fail, and is something older still shown. */
export type ReadHealth = { error: WalletError | null; hasData: boolean };

export type StaleBanner = {
  /** 'stale': an older answer is shown; 'unread': a part has no answer at all yet. */
  kind: 'stale' | 'unread';
  title: string;
  text: string;
  /** The parts concerned, in the owner's words, in a fixed order. */
  parts: string[];
  /** The banner offers "Try again" (it reads the failed reads again; nothing else). */
  retry: true;
};

const ORDER: readonly StalePart[] = ['attention', 'deals', 'settings', 'runs', 'labels'];

/** The banner for a set of reads, or null when every read's last try succeeded. A part that never
 *  answered outranks a part that is only out of date: the banner then says "not available yet". */
export function staleBannerOf(reads: Partial<Record<StalePart, ReadHealth>>): StaleBanner | null {
  const failed = ORDER.filter((p) => reads[p]?.error);
  if (failed.length === 0) return null;
  const unread = failed.some((p) => !reads[p]?.hasData);
  return {
    kind: unread ? 'unread' : 'stale',
    title: unread ? UNREAD_TITLE : STALE_TITLE,
    text: unread ? UNREAD_TEXT : STALE_TEXT,
    parts: failed.map((p) => STALE_PART[p]),
    retry: true,
  };
}
