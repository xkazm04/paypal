// Which deal this approval window was opened for.
//
//   1. approval_selection (pending extension; the real shell answers UNAVAILABLE today)
//   2. attention_list - in the approval window Rust filters it to the selected deal only
//   3. the approval:summary event, which Rust pushes right after the window opens and again on
//      every actor change. It can arrive before or after this page subscribes, so it always wins
//      when it does arrive.
//
// Nothing found = the window was opened with deal_id=null: owner configuration review.
import { useEffect, useState } from 'react';
import type { ApprovalHandoff } from '@bindings/ApprovalHandoff';
import type { ApprovalSummary } from '@bindings/ApprovalSummary';
import { useEvent, useQuery } from '../../lib/hooks';
import { backend } from '../../lib/runtime';

/** 'none' = the shell said no deal; 'unknown' = the selection read is unavailable and the
 *  fallbacks found nothing (the summary event can still arrive and switch to review mode). */
export type SelectionSource = 'selection' | 'attention' | 'event' | 'none' | 'unknown';
export type Selection =
  | { status: 'resolving' }
  | { status: 'resolved'; dealId: string | null; source: SelectionSource; seed: ApprovalSummary | null };

export async function resolveSelectedDeal(): Promise<{ dealId: string | null; source: SelectionSource }> {
  try {
    const id = await backend().invoke('approval_selection', null);
    return { dealId: id, source: id ? 'selection' : 'none' };
  } catch {
    // UNAVAILABLE on the current shell (or any typed refusal): that is not "no deal", so try
    // the real fallback below before concluding configuration mode.
  }
  try {
    const snap = await backend().invoke('attention_list', null);
    const first = snap.items[0];
    if (first) return { dealId: first.deal_id, source: 'attention' };
  } catch {
    /* fall through to configuration mode; the summary event may still arrive */
  }
  return { dealId: null, source: 'unknown' };
}

/** What The Table opened this window for, and its pre-fill (approval_handoff). Never authority:
 *  every value is shown for the owner to check, and Rust re-checks it on sign. null = not read
 *  (an older shell) or nothing handed over. */
export function useHandoff(): ApprovalHandoff | null {
  const q = useQuery('approval_handoff', null);
  return q.data ?? null;
}

export function useSelection(): Selection {
  const [sel, setSel] = useState<Selection>({ status: 'resolving' });

  // Subscribe first (the event may fire at any time), then resolve.
  useEvent('approval:summary', (s) => {
    setSel({ status: 'resolved', dealId: s.deal.id, source: 'event', seed: s });
  });

  useEffect(() => {
    let dead = false;
    void resolveSelectedDeal().then((r) => {
      if (dead) return;
      setSel((prev) => (prev.status === 'resolved' && prev.source === 'event' ? prev : { status: 'resolved', dealId: r.dealId, source: r.source, seed: null }));
    });
    return () => {
      dead = true;
    };
  }, []);

  return sel;
}
