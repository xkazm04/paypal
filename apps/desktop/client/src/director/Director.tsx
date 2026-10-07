// BROWSER PREVIEW ONLY. The scenario director: a dark stage with the three real windows framed at
// their native sizes (The Table 1280 x 800, the approval window 744 x 660, the Tumbler in its desk
// corner), a caption rail, and play / pause / step / restart over the beat file.
//
// The page holds the mock world's stand-in for the wallet core (one mock instance): it moves the
// shared clock and sends the core's events, and the framed windows hear them over the mock's
// BroadcastChannel exactly as separate windows do. It never clicks inside a window: approving
// stays the viewer's own click, and in the mock that click moves no real money.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { clockOffset } from '../lib/clock';
import { clockLabel } from '../lib/format';
import { useNow, usePrefersReducedMotion } from '../lib/hooks';
import { applyTheme, getTheme, setTheme, type Theme } from '../lib/theme';
import { mockBackend } from '../mock/backend';
import { applyWorld, foldScene, INITIAL_SCENE, runActions, WORLD_ACTIONS, type Scene, type Stage } from './actions';
import { BEATS, CHAPTERS, SCRIPT_LENGTH, chapterOf, type Focus } from './beats';

type Rect = { x: number; y: number; w: number; h: number };

/** The director's desk in logical pixels; the windows keep their real sizes on it. A window's
 *  rectangle is its content; the director's title bar sits above it. */
const BAR = 30;
const WIN = {
  main: { x: 40, y: 64, w: 1280, h: 800 },
  approval: { x: 1010, y: 130, w: 744, h: 660 },
  tumbler: { x: 1274, y: 540, w: 520, h: 460 },
} as const;
const DESK = { w: 1800, h: 1010 };
const around = (r: { x: number; y: number; w: number; h: number }, pad: number): Rect => ({ x: r.x - pad, y: r.y - BAR - pad, w: r.w + 2 * pad, h: r.h + BAR + 2 * pad });
const CAMERA: Record<Focus, Rect> = {
  desk: { x: 0, y: 0, w: DESK.w, h: DESK.h },
  main: around(WIN.main, 16),
  approval: around(WIN.approval, 24),
  // the Tumbler grows up and left from its puck in the corner: frame the lower part of its patch
  tumbler: { x: WIN.tumbler.x - 230, y: WIN.tumbler.y + 30, w: WIN.tumbler.w + 230, h: WIN.tumbler.h - 10 },
};
const MAX_ZOOM = 1.15;
/** Frames need a moment after load to subscribe and draw before the core speaks to them. */
const SETTLE_MS = 900;
/** After the Tumbler is put back on a seek, let its own form requests land before the beat plays. */
const REPLAY_MS = 600;

type Frames = { epoch: number; mainSrc: string; approvalSrc: string; approvalKey: number };

function param(name: string): string | null {
  try {
    return new URLSearchParams(location.search).get(name);
  } catch {
    return null;
  }
}

function startIndex(): number {
  const b = param('beat');
  if (!b) return 0;
  const byId = BEATS.findIndex((x) => x.id === b);
  if (byId >= 0) return byId;
  const n = Number(b);
  return Number.isInteger(n) && n >= 0 && n < BEATS.length ? n : 0;
}

function camera(rect: Rect, box: { w: number; h: number }): CSSProperties {
  if (!box.w || !box.h) return { opacity: 0 };
  const s = Math.min(box.w / rect.w, box.h / rect.h, rect === CAMERA.desk ? 1 : MAX_ZOOM);
  const tx = (box.w - rect.w * s) / 2 - rect.x * s;
  const ty = (box.h - rect.h * s) / 2 - rect.y * s;
  return { transform: `translate(${Math.round(tx)}px, ${Math.round(ty)}px) scale(${s.toFixed(4)})` };
}

function offsetWords(seconds: number): string | null {
  if (seconds < 60) return null;
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [d ? `${d} d` : '', h ? `${h} h` : '', !d && m ? `${m} min` : ''].filter(Boolean);
  return `${parts.join(' ')} later`;
}

/** The fixtures' sentences name times of day ("lapses at 18:00", "at 20:00"): they assume the
 *  week is seen at 14:02:04, so the director starts its clock there (today, local time). */
function storyStart(): number {
  const d = new Date();
  d.setHours(14, 2, 4, 0);
  return Math.floor(d.getTime() / 1000);
}

const approvalUrl = (id: string | null) => (id ? `approval.html?deal=${encodeURIComponent(id)}&target=deal` : 'about:blank');

export function Director() {
  // The wallet core's stand-in for this preview (a mock instance with no window of its own).
  const core = useMemo(() => mockBackend('main'), []);
  const world = core.world;
  const now = useNow();
  const reduced = usePrefersReducedMotion();

  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(param('play') !== '0');
  const [ready, setReady] = useState(false);
  const [t, setT] = useState(0);
  const [mainOpen, setMainOpen] = useState(true);
  const [approvalOpen, setApprovalOpen] = useState(false);
  // the window the viewer opened themselves (until the next beat): the camera follows them
  const [viewerFocus, setViewerFocus] = useState<Focus | null>(null);
  const approvalOpenRef = useRef(false);
  approvalOpenRef.current = approvalOpen;
  const [frames, setFrames] = useState<Frames>({ epoch: 0, mainSrc: 'about:blank', approvalSrc: 'about:blank', approvalKey: 0 });
  const [follow, setFollow] = useState(param('camera') !== 'desk');
  const [theme, setThemeState] = useState<Theme>(getTheme());
  const [box, setBox] = useState({ w: 0, h: 0 });

  const indexRef = useRef(-1);
  /** The clock offset at the start of the story, so the rail can say how much later it is. */
  const startOffset = useRef(0);
  const tRef = useRef(0);
  const pending = useRef<{ epoch: number; n: number; scene: Scene; loaded: Set<string> } | null>(null);
  const epochRef = useRef(0);
  const mainRef = useRef<HTMLIFrameElement>(null);
  const tumblerRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  // ---- the stage the beats act on ------------------------------------------------------------
  const navigateMain = useCallback((route: string) => {
    try {
      const w = mainRef.current?.contentWindow;
      if (w) w.location.hash = route.replace(/^#/, '');
    } catch {
      /* the frame is between documents; the next beat routes it again */
    }
  }, []);
  const stage = useMemo<Stage>(() => ({
    world,
    form: (f) => {
      world.emit('tumbler:form', f);
      world.emit('tumbler:status', { visible: true, form: f, count: world.attention().items.length });
    },
    main: (open, route) => {
      setMainOpen(open);
      if (route !== null) navigateMain(route);
    },
    approval: (id) => {
      if (id) setFrames((f) => ({ ...f, approvalSrc: approvalUrl(id), approvalKey: f.approvalKey + 1 }));
      setApprovalOpen(!!id);
    },
  }), [world, navigateMain]);

  // A framed window may move focus into itself when the story drives it (a card opening, a route).
  // Unless the viewer is working in that frame, give the keyboard back to the director.
  const lastFrameInput = useRef(0);
  const watchInput = useCallback((f: HTMLIFrameElement) => {
    try {
      const w = f.contentWindow;
      const mark = () => { lastFrameInput.current = Date.now(); };
      w?.addEventListener('pointerdown', mark, true);
      w?.addEventListener('keydown', mark, true);
    } catch {
      /* not loaded yet */
    }
  }, []);
  const keepKeyboard = useCallback(() => {
    setTimeout(() => {
      const a = document.activeElement;
      if (a instanceof HTMLIFrameElement && Date.now() - lastFrameInput.current > 3000) a.blur();
    }, 700);
  }, []);

  const play = useCallback((i: number) => {
    const b = BEATS[i];
    if (!b) return;
    runActions(stage, b.do);
    keepKeyboard();
    setViewerFocus(null);
    indexRef.current = i;
    setIndex(i);
  }, [stage, keepKeyboard]);

  /** Rebuild the world up to beat `n`, reload the frames on that scene, then play beat `n`. */
  const seek = useCallback((n: number) => {
    const target = Math.max(0, Math.min(BEATS.length - 1, n));
    setReady(false);
    world.reset(storyStart());
    startOffset.current = clockOffset();
    for (const b of BEATS.slice(0, target)) for (const a of b.do) if (WORLD_ACTIONS.has(a.do)) applyWorld(world, a);
    const sc = BEATS.slice(0, target).reduce((s, b) => foldScene(s, b.do), INITIAL_SCENE);
    const approvalId = sc.approval ? world.deal(sc.approval)?.deal.id ?? null : null;
    setMainOpen(sc.main.open);
    setApprovalOpen(!!approvalId);
    const epoch = ++epochRef.current;
    pending.current = { epoch, n: target, scene: sc, loaded: new Set() };
    setFrames((f) => ({ epoch, mainSrc: `index.html${sc.main.route ?? ''}`, approvalSrc: approvalUrl(approvalId), approvalKey: f.approvalKey + 1 }));
    indexRef.current = target - 1;
    setIndex(target - 1);
    tRef.current = BEATS[target]?.at ?? 0;
    setT(tRef.current);
  }, [world]);

  const frameLoaded = useCallback((which: 'main' | 'tumbler' | 'approval', epoch: number) => {
    const p = pending.current;
    if (!p || p.epoch !== epoch) return;
    p.loaded.add(which);
    if (!p.loaded.has('main') || !p.loaded.has('tumbler')) return;
    pending.current = null;
    const current = () => p.epoch === epochRef.current; // a newer seek supersedes this one
    setTimeout(() => {
      if (!current()) return;
      // Put the Tumbler back where the earlier beats left it, then play the beat itself.
      if (p.scene.selected && p.scene.form === 'card') runActions(stage, [{ do: 'select', deal: p.scene.selected }]);
      else if (p.scene.form !== 'rest') stage.form(p.scene.form);
      if (p.scene.visual) world.emit('tumbler:visual', p.scene.visual);
      const restored = p.scene.form !== 'rest' || !!p.scene.visual;
      setTimeout(() => {
        if (!current()) return;
        play(p.n);
        setReady(true);
      }, restored ? REPLAY_MS : 0);
    }, SETTLE_MS);
  }, [play, stage, world]);

  // boot once (StrictMode runs effects twice in development)
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    seek(startIndex());
  }, [seek]);

  // ---- the scenario clock ----------------------------------------------------------------------
  useEffect(() => {
    if (!playing || !ready) return;
    let last = performance.now();
    const id = setInterval(() => {
      const at = performance.now();
      tRef.current = Math.min(SCRIPT_LENGTH, tRef.current + (at - last) / 1000);
      last = at;
      setT(tRef.current);
      const next = indexRef.current + 1;
      const nb = BEATS[next];
      if (nb && tRef.current >= nb.at) play(next);
      if (tRef.current >= SCRIPT_LENGTH) setPlaying(false);
    }, 200);
    return () => clearInterval(id);
  }, [playing, ready, play]);

  const atEnd = index >= BEATS.length - 1 && t >= SCRIPT_LENGTH - 0.01;
  const onPlay = useCallback(() => {
    if (atEnd) {
      seek(0);
      setPlaying(true);
      return;
    }
    setPlaying((p) => !p);
  }, [atEnd, seek]);
  const onNext = useCallback(() => {
    const n = indexRef.current + 1;
    if (!ready || n >= BEATS.length) return;
    tRef.current = BEATS[n]?.at ?? tRef.current;
    setT(tRef.current);
    play(n);
  }, [play, ready]);
  const onPrev = useCallback(() => seek(Math.max(0, indexRef.current - 1)), [seek]);
  const onRestart = useCallback(() => { seek(0); setPlaying(true); }, [seek]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select')) return;
      if (e.key === ' ' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); onPlay(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); onNext(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); onPrev(); }
      else if (e.key === 'Home') { e.preventDefault(); onRestart(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onPlay, onNext, onPrev, onRestart]);

  // ---- layout ----------------------------------------------------------------------------------
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => { if (e) setBox({ w: e.contentRect.width, h: e.contentRect.height }); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const beat = index >= 0 ? BEATS[index] : undefined;
  const focus: Focus = follow ? viewerFocus ?? beat?.focus ?? 'desk' : 'desk';
  // The camera never frames a closed window: fall back to the whole desk.
  const shot = (focus === 'approval' && !approvalOpen) || (focus === 'main' && !mainOpen) ? 'desk' : focus;
  const deskStyle = camera(CAMERA[shot], box);

  // The Table follows the stored theme; the Tumbler and the approval window are always dark.
  const applyFrameTheme = useCallback((th: Theme) => {
    try {
      applyTheme(th, mainRef.current?.contentDocument?.documentElement ?? null);
    } catch {
      /* frame not ready */
    }
  }, []);
  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setThemeState(next);
    applyFrameTheme(next);
  };

  // A window the viewer opens from inside a frame (Review in the Tumbler, Open in The Table) lands
  // in the framed window of that name; show it.
  const onApprovalLoad = (epoch: number) => {
    frameLoaded('approval', epoch);
    try {
      const w = document.querySelector<HTMLIFrameElement>('iframe[name="the-table-approval"]')?.contentWindow;
      const href = w?.location.href ?? '';
      if (href.includes('approval.html')) {
        if (!approvalOpenRef.current) setViewerFocus('approval');
        setApprovalOpen(true);
      }
    } catch {
      /* cross-document moment */
    }
  };
  const onMainLoad = (epoch: number) => {
    frameLoaded('main', epoch);
    applyFrameTheme(getTheme());
    try {
      mainRef.current?.contentWindow?.addEventListener('hashchange', () => setMainOpen(true));
    } catch {
      /* ignore */
    }
  };

  const chapter = beat ? chapterOf(beat.chapter) : CHAPTERS[0];
  const chapterNo = beat ? CHAPTERS.findIndex((c) => c.id === beat.chapter) : 0;
  const later = offsetWords(clockOffset() - startOffset.current);

  const win = (r: Rect): CSSProperties => ({ left: r.x, top: r.y - BAR, width: r.w, height: r.h + BAR });

  return (
    <div className={`dir${reduced ? ' reduced' : ''}`}>
      <header className="dir-banner" role="note">
        <span className="dir-dot" aria-hidden="true" />
        <span>Browser preview with sample data — not the wallet. No PayPal page is ever shown.</span>
      </header>

      <main className="dir-stage" ref={stageRef} aria-label="The three windows of The Table, on sample data">
        <div className="dir-desk" style={{ width: DESK.w, height: DESK.h, ...deskStyle }}>
          <section className={`dir-win w-main${mainOpen ? '' : ' closed'}`} style={win(WIN.main)} aria-label="The Table (main window)" aria-hidden={!mainOpen}>
            <WinBar title="The Table" />
            <iframe key={`m${frames.epoch}`} ref={mainRef} name="the-table-main" title="The Table" src={frames.mainSrc}
              width={WIN.main.w} height={WIN.main.h} onLoad={(e) => { watchInput(e.currentTarget); onMainLoad(frames.epoch); }} />
          </section>
          <div className={`dir-ghost${mainOpen || shot !== 'desk' ? '' : ' on'}`} style={win(WIN.main)} aria-hidden={mainOpen}>
            <span>The Table is closed</span>
          </div>

          <section className={`dir-win w-approval${approvalOpen ? '' : ' closed'}`} style={win(WIN.approval)} aria-label="The approval window" aria-hidden={!approvalOpen}>
            <WinBar title="Approval" note="only here can money be agreed" />
            <iframe key={`a${frames.epoch}:${frames.approvalKey}`} name="the-table-approval" title="Approval" src={frames.approvalSrc}
              width={WIN.approval.w} height={WIN.approval.h} onLoad={(e) => { watchInput(e.currentTarget); onApprovalLoad(frames.epoch); }} />
          </section>

          <section className="dir-tum" style={{ left: WIN.tumbler.x, top: WIN.tumbler.y, width: WIN.tumbler.w, height: WIN.tumbler.h }} aria-label="The Tumbler">
            <iframe key={`t${frames.epoch}`} ref={tumblerRef} name="the-table-tumbler" title="The Tumbler" src="tumbler.html?frame=director"
              width={WIN.tumbler.w} height={WIN.tumbler.h} onLoad={(e) => { watchInput(e.currentTarget); frameLoaded('tumbler', frames.epoch); }} />
          </section>
        </div>
        {!ready ? <div className="dir-loading" role="status"><span />Setting the table…</div> : null}
      </main>

      <footer className="dir-rail" aria-label="Story">
        <div className="dir-cap" aria-live="polite">
          <div className="dir-kicker">
            <span className="dir-chap">{chapterNo > 0 && chapterNo < CHAPTERS.length - 1 ? `${chapterNo} · ` : ''}{chapter?.title}</span>
            <span className="dir-time" title="The preview’s clock: it jumps ahead so deadlines arrive in seconds">
              {clockLabel(now)}{later ? <em>{later}</em> : null}
            </span>
          </div>
          <p className="dir-text">{beat?.caption ?? 'Setting the table…'}</p>
        </div>

        <div className="dir-ctl">
          <div className="dir-transport" role="group" aria-label="Playback">
            <button className="dir-btn" onClick={onRestart} aria-label="Restart" title="Restart (Home)"><Glyph d="M4 4v5h5M4.6 9A7 7 0 1 1 5 15" /></button>
            <button className="dir-btn" onClick={onPrev} disabled={index <= 0} aria-label="Previous beat" title="Previous (←)"><Glyph d="M14 5l-6 7 6 7" /></button>
            <button className="dir-btn play" onClick={onPlay} aria-label={playing && !atEnd ? 'Pause' : 'Play'} title={playing && !atEnd ? 'Pause (space)' : 'Play (space)'}>
              {playing && !atEnd ? <Glyph d="M8 5v14M16 5v14" w={2.4} /> : <Glyph d="M8 5l11 7-11 7z" fill />}
            </button>
            <button className="dir-btn" onClick={onNext} disabled={!ready || index >= BEATS.length - 1} aria-label="Next beat" title="Next (→)"><Glyph d="M10 5l6 7-6 7" /></button>
          </div>
          <div className="dir-opts">
            <button className="dir-chip" aria-pressed={follow} onClick={() => setFollow((f) => !f)} title="Move the camera to the window the story is about">Follow the story</button>
            <button className="dir-chip" onClick={toggleTheme} title="Light or dark for The Table">{theme === 'dark' ? 'Light' : 'Dark'}</button>
          </div>
        </div>

        <nav className="dir-scrub" aria-label="Beats">
          {CHAPTERS.map((c) => {
            const beats = BEATS.map((b, i) => ({ b, i })).filter((x) => x.b.chapter === c.id);
            const first = beats[0];
            const lastBeat = beats[beats.length - 1];
            if (!first || !lastBeat) return null;
            const nextChapter = BEATS[lastBeat.i + 1];
            const end = nextChapter ? nextChapter.at : SCRIPT_LENGTH;
            const span = end - first.b.at;
            return (
              <div key={c.id} className={`dir-seg${beat?.chapter === c.id ? ' on' : ''}`} style={{ flexGrow: span }}>
                <span className="dir-seg-t">{c.title}</span>
                <div className="dir-ticks">
                  <span className="dir-fill" style={{ width: `${(Math.max(0, Math.min(1, (t - first.b.at) / span)) * 100).toFixed(2)}%` }} aria-hidden="true" />
                  {beats.map(({ b, i }) => (
                    <button key={b.id} className={`dir-tick${i === index ? ' on' : i < index ? ' past' : ''}`}
                      style={{ left: `${(((b.at - first.b.at) / span) * 100).toFixed(2)}%` }}
                      onClick={() => seek(i)} aria-label={`Go to: ${b.caption}`} aria-current={i === index ? 'step' : undefined} title={b.caption} />
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
      </footer>
    </div>
  );
}

function WinBar({ title, note }: { title: string; note?: string }) {
  return (
    <div className="dir-bar" aria-hidden="true">
      <span className="dir-bar-ic" />
      <b>{title}</b>
      {note ? <span className="dir-bar-note">{note}</span> : null}
      <span className="dir-bar-wc">
        <i className="min" /><i className="max" /><i className="x" />
      </span>
    </div>
  );
}

function Glyph({ d, w = 2, fill = false }: { d: string; w?: number; fill?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d={d} fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
