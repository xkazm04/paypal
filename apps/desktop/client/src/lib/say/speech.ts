// Speech is only an input: it types the sentence for the owner to check, and the reader reads it exactly like
// anything typed. It sits behind a feature check (no recogniser = no mic, and typing is the whole feature),
// never trusts what it heard, and the wallet never gets audio: the browser's own speech service hears it.
// (Where that service sends the audio is the browser's business; the panel says so.)

/** The slice of the Web Speech API this uses. */
type Recogniser = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type RecogniserCtor = new () => Recogniser;

/** The browser's recogniser, or null when it has none (or a test stubbed it away). */
export function speechSupport(w: Window = window): RecogniserCtor | null {
  const x = w as unknown as { SpeechRecognition?: RecogniserCtor; webkitSpeechRecognition?: RecogniserCtor };
  return x.SpeechRecognition ?? x.webkitSpeechRecognition ?? null;
}

export type Listening = { stop: () => void };

/**
 * Start listening. `onText` gets the transcript so far (interim and final), `onDone` the final one when
 * listening ends, `onFail` a short reason when it could not (no permission, no network, nothing heard).
 * Returns null when there is no recogniser.
 */
export function listen(h: { onText: (text: string) => void; onDone: (text: string) => void; onFail: (reason: string) => void; lang?: string }, w: Window = window): Listening | null {
  const Ctor = speechSupport(w);
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = h.lang ?? 'en-US';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let text = '';
  let failed = false;
  rec.onresult = (e) => {
    let t = '';
    for (let i = 0; i < e.results.length; i++) t += e.results[i]?.[0]?.transcript ?? '';
    text = t.trim();
    h.onText(text);
  };
  rec.onerror = (e) => { failed = true; h.onFail(e.error); };
  rec.onend = () => { if (!failed) h.onDone(text); };
  try { rec.start(); } catch (err) { h.onFail(err instanceof Error ? err.name : 'error'); return null; }
  return { stop: () => { try { rec.stop(); } catch { /* already stopped */ } } };
}

// ---- reading it back aloud (the browser's own synthesiser; nothing is sent by this code, and it is off without one)

type Synth = { speak: (u: unknown) => void; cancel: () => void };
type UtteranceCtor = new (text: string) => { lang: string; rate: number; onend: (() => void) | null; onerror: (() => void) | null };

const synth = (w: Window): { s: Synth; U: UtteranceCtor } | null => {
  const x = w as unknown as { speechSynthesis?: Synth; SpeechSynthesisUtterance?: UtteranceCtor };
  return x.speechSynthesis && x.SpeechSynthesisUtterance ? { s: x.speechSynthesis, U: x.SpeechSynthesisUtterance } : null;
};

/** The browser can read text aloud. */
export const canReadAloud = (w: Window = window): boolean => synth(w) !== null;

/** Read `text` aloud; returns a way to stop it, or null when there is no synthesiser. `onEnd` runs when it finishes or fails. */
export function readAloud(text: string, onEnd: () => void, w: Window = window): (() => void) | null {
  const x = synth(w);
  if (!x) return null;
  try {
    x.s.cancel();
    const u = new x.U(text);
    u.lang = 'en-US';
    u.rate = 0.95;
    u.onend = onEnd;
    u.onerror = onEnd;
    x.s.speak(u);
  } catch {
    return null;
  }
  return () => { try { x.s.cancel(); } catch { /* nothing playing */ } };
}

