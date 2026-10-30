// live.ts - the arena's live mode: a judge's own agent app playing through table-sandbox.
//
// WHY a separate module: the recorded cards are the arena's default and the film's. Live mode is an
// optional second source that exists only while `cargo run -p table-sandbox` runs on this machine.
// The arena renders whatever this module reports and never talks to the sandbox itself, so the
// recorded path cannot depend on a live server.
//
// STUB (spark hackathon-fusion-killer-1030, before WP2/WP3): the signature is final; WP3 implements
// the probe, the journal polling and the note send. Until then the arena is always recorded.

export type LiveAnswer = { at: string; tool: string; verdict: 'yes' | 'no'; rule: string | null; sentence: string; paypalAsked: number };
export type LiveState =
  | { status: 'recorded' } // no sandbox: the 14 recorded cards
  | { status: 'live'; table: string | null; answers: LiveAnswer[] };

export const LIVE_PORT = 1443;

const RECORDED: LiveState = { status: 'recorded' };

export function useLive(): LiveState {
  return RECORDED;
}

export async function sendLiveNote(_text: string): Promise<boolean> {
  return false;
}
