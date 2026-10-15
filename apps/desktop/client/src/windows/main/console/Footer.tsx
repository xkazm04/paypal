// The console's footer (rebuild WP2, extracted in the polish wave): the mode badge and the preview
// badge, the engine/agents chips, today's two meters, the safe-default line, the mini-window state,
// calm motion, the theme, the shortcuts help and the clock; and demo mode's switcher (DemoSwitch.tsx).
// In a desktop demo the demo badge stands where the browser preview's badge would; after the sample
// data failed to open (lib/runtime.ts fallback) the footer says so once.
import { useEffect, useState } from 'react';
import type { TumblerStatus } from '@bindings/TumblerStatus';
import { useEvent, useNow } from '../../../lib/hooks';
import { demoNow, takeDemoNotice } from '../../../lib/preview';
import { BOOK_TODAY, CALM, DEMO_FALLBACK_NOTE, METERS, MINI_WINDOW, SAFE_DEFAULT_LINE, SHORTCUTS_LABEL } from '../../../lib/words';
import { formatMinor } from '../../../lib/format';
import { MockBadge, ModeBadge } from '../../../shared/honesty';
import { ThemeSwitch, useToast } from '../../../shared/ui';
import { spendToday } from '../logic';
import { StatusChips } from '../Status';
import { useAttention, useDeals, useNeeds, useSettings } from '../world';
import { calmToggled, writeCalm } from './calm';
import { DemoSwitch } from './DemoSwitch';
import { paidTodayText, usePaidToday } from './areas/book/today';
import './footer.css';

export type FooterProps = {
  /** Opens the Settings layer (the engine/agents chips lead there). */
  onSettings: () => void;
  /** Opens the keyboard shortcuts help. */
  onHelp: () => void;
};

export function Footer({ onSettings, onHelp }: FooterProps) {
  const settings = useSettings().data;
  const [tumbler, setTumbler] = useState<TumblerStatus | null>(null);
  useEvent('tumbler:status', (s) => setTumbler(s));
  const [nativeDemo] = useState(() => { const d = demoNow(); return d.native && d.state !== null; });
  const toast = useToast();
  useEffect(() => { if (takeDemoNotice()) toast(DEMO_FALLBACK_NOTE, 'info'); }, [toast]);
  return (
    <footer className="cs-foot">
      {settings ? <ModeBadge mode={settings.mode} /> : null}
      {nativeDemo ? null : <MockBadge />}
      <DemoSwitch />
      <StatusChips onSettings={onSettings} />
      <TodayMeters />
      <span className="ui-spacer" />
      <span className="cs-promise"><Hourglass />{SAFE_DEFAULT_LINE}</span>
      <span className="ui-spacer" />
      <TumblerPill status={tumbler} />
      <CalmToggle />
      <ThemeSwitch className="cs-theme" />
      <button type="button" className="cs-help" onClick={onHelp} aria-label={SHORTCUTS_LABEL} title={`${SHORTCUTS_LABEL} (?)`}>?</button>
      <Clock />
    </footer>
  );
}

/** Today's two meters, never one axis: money your agents paid out against the signed wallet limit
 *  (or what they committed), and the agent app's own estimate of its AI usage (never a bill). */
function TodayMeters() {
  const settings = useSettings().data;
  const att = useAttention().data;
  const deals = useDeals().data;
  const needs = useNeeds();
  const pt = usePaidToday(att?.exposure, deals, needs);
  if (!settings) return null;
  if (!(settings.meters_available || att?.exposure) || !att) return <span className="cs-chip dashed" title={METERS.noneTitle}>{METERS.none}</span>;
  // Paid out today is money PayPal collected today, never a hold or an agreed payment (scale
  // finding #9): the same set the Book's "paid out today" counts (console/areas/book/today.ts).
  const sp = spendToday(att.wallet_spend_today_minor, att.wallet_spend_today_currency);
  return (
    <>
      {pt ? (
        <span className={`tb-meter${pt.near ? ' near' : ''}`} data-meter="paid-today"
          title={BOOK_TODAY.title(pt.held ? formatMinor(pt.held.minor, pt.held.currency) : null, pt.committed ? formatMinor(pt.committed.minor, pt.committed.currency) : null, pt.budget ? formatMinor(pt.budget.minor, pt.budget.currency) : null, pt.limit ? formatMinor(pt.limit.minor, pt.limit.currency) : null)}>
          <b>{paidTodayText(pt, BOOK_TODAY.nothing)}</b><span>{METERS.paidOut}</span>
        </span>
      ) : (
        <span className={`tb-meter ${sp.exact ? '' : 'unknown'}`} title={sp.why ?? METERS.spentTitle}><b>{sp.text}</b><span>{METERS.spent}</span></span>
      )}
      {settings.meters_available ? (
        <span className="tb-meter eng" title={METERS.aiTitle}><b>~${att.engine_estimate_today_usd.toFixed(2)}</b><span>{METERS.ai}</span></span>
      ) : null}
    </>
  );
}

function TumblerPill({ status }: { status: TumblerStatus | null }) {
  if (!status) return null;
  return (
    <span className={`cs-chip ${status.visible ? '' : 'dashed'}`} title={MINI_WINDOW.title}>
      {MINI_WINDOW.name} · {status.visible ? MINI_WINDOW.shown : MINI_WINDOW.hidden}{status.count ? <> · <b>{status.count}</b> {MINI_WINDOW.waiting}</> : null}
    </span>
  );
}

function CalmToggle() {
  const [on, setOn] = useState(calmToggled);
  return (
    <button type="button" className="cs-chip cs-calm" aria-pressed={on} title={CALM.title} onClick={() => { writeCalm(!on); setOn(!on); }}>
      {CALM.label}
    </button>
  );
}

function Clock() {
  const now = useNow();
  const d = new Date(now * 1000);
  return <span className="cs-clk">{d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · {d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>;
}

function Hourglass() {
  return <svg viewBox="0 0 12 14" aria-hidden="true" focusable="false"><path d="M2 1h8M2 13h8M3 1c0 4 6 4 6 6s-6 2-6 6M9 1c0 4-6 4-6 6s6 2 6 6" fill="none" stroke="currentColor" strokeWidth="1.1" /></svg>;
}
