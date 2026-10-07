// Layer 1/2 frame (v2, prototype/main module screens): a 38px title bar (‹ The Table Esc, crumbs,
// mode badge, the two separate meters, Find, Lock), a 208px sidebar with the six modules and their
// needs/count badges, a footer with Mandates / Pairing / Settings, the ui-main content area and an
// inspector column that any <Inspector> inside the page portals into (src/shared/ui/Inspector.tsx).
// Module pages only fill `children`. Routing, keys 1-6 and Esc stay in App.tsx.
import type { ReactNode } from 'react';
import type { Module } from '@bindings/Module';
import type { TumblerStatus } from '@bindings/TumblerStatus';
import { useMutation } from '../../lib/hooks';
import { readLimits } from '../../lib/limits';
import { MockBadge, ModeBadge } from '../../shared/honesty';
import { Glyph, MODULE, MODULES } from '../../shared/modules';
import { Btn, Chip, Crumbs, InspectorHostProvider, Sidebar, SidebarItem, Spacer, TitleBar, useInspectorHost } from '../../shared/ui';
import { spendToday, type SheetTab } from './logic';
import { LockGlyph, mc } from './ui';
import { useWorld } from './world';
import './shell.css';

export type Crumb = { label: string; onClick?: () => void };

export function Shell({ module, crumbs, onHome, onModule, onSheet, onFind, tumbler, children }: {
  module: Module; crumbs: Crumb[]; onHome: () => void; onModule: (m: Module) => void; onSheet: (t: SheetTab) => void; onFind: () => void;
  tumbler: TumblerStatus | null; children: ReactNode;
}) {
  const w = useWorld();
  const settings = w.settings.data;
  const att = w.attention.data;
  const deals = w.deals.data ?? [];
  const insp = useInspectorHost();
  const engine = settings?.selected_engine;
  return (
    <div className="ui-app shell-app" style={mc(module)}>
      <TitleBar>
        <Btn sm onClick={onHome} title="Back to The Table (Esc)">‹ The Table</Btn>
        <Crumbs items={[{ label: 'The Table', onClick: onHome }, ...crumbs]} />
        <Spacer />
        {settings ? <ModeBadge mode={settings.mode} /> : null}
        <span className="tb-hide"><MockBadge /></span>
        {(settings?.meters_available || att?.exposure) && att ? (
          <>
            <SpendMeter att={att} />
            {settings?.meters_available ? (
              <div className="tb-meter eng" title="What your agent app estimates its AI usage cost today. An estimate, not a bill, and never used for money decisions.">
                <b>~${att.engine_estimate_today_usd.toFixed(2)}</b><span>AI usage, estimate</span>
              </div>
            ) : null}
          </>
        ) : settings ? (
          <Chip tone="dashed" title="Today’s spend and AI usage appear here once the wallet can count them.">spend not counted yet</Chip>
        ) : null}
        <Btn sm onClick={onFind} title="Find (Ctrl K)">Find <span className="kbd">Ctrl K</span></Btn>
        <ShellLock />
      </TitleBar>
      <InspectorHostProvider value={insp.value}>
        <div className={`ui-split ${insp.open ? 'has-insp' : ''}`}>
          <Sidebar label="Modules" foot={
            <>
              <SidebarItem label="Agent rules" icon={<svg width="14" height="14" viewBox="0 0 16 16"><path d="M4 1.5h6l3 3v10H4z" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M6 8h5M6 11h4" stroke="currentColor" strokeWidth="1.4" /></svg>} onClick={() => onSheet('mandates')} title="What your agents may do, and the limits you signed" />
              <SidebarItem label="Connections" icon={<svg width="14" height="14" viewBox="0 0 16 16"><circle cx="5" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.4" /><circle cx="11" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>} onClick={() => onSheet('pairing')} title="Connect with another wallet, or open the house seller" />
              <SidebarItem label="Settings" icon={<svg width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M8 1.5v2.2M8 12.3v2.2M1.5 8h2.2M12.3 8h2.2M3.4 3.4l1.6 1.6M11 11l1.6 1.6M3.4 12.6 5 11M11 5l1.6-1.6" stroke="currentColor" strokeWidth="1.4" /></svg>} onClick={() => onSheet('settings')} title={engine ? `Agent app: ${engine === 'scripted' ? 'practice agent' : engine}` : 'Agent app, safety and PayPal'} />
              <div className="shell-status ui-hint">
                {settings?.agents_paused ? <span className="gold">agents paused</span> : null}
                {tumbler ? <span title="The small always-on-top window">Mini window · {tumbler.visible ? 'shown' : 'hidden'}{tumbler.count ? <> · <b>{tumbler.count}</b> waiting</> : null}</span> : null}
              </div>
            </>
          }>
            {MODULES.map((m, i) => {
              const n = w.needs.filter((x) => x.module === m.key).length;
              const count = m.key === 'book' ? deals.length : deals.filter((d) => w.moduleOfDeal(d) === m.key).length;
              return (
                <SidebarItem key={m.key} on={module === m.key} style={mc(m.key)} onClick={() => onModule(m.key)} className="two"
                  icon={<Glyph module={m.key} />} label={<span className="sb2"><b>{m.name}</b><small>{m.long}</small></span>} title={`${m.long} (${i + 1})`}
                  count={n || count} need={n > 0} countTitle={n ? `${n} need${n === 1 ? 's' : ''} you` : `${count} deal${count === 1 ? '' : 's'}`} />
              );
            })}
          </Sidebar>
          <main className="ui-main view" tabIndex={-1}>
            <div className="view-inner">{children}</div>
          </main>
          <aside className="ui-inspector" ref={insp.ref} hidden={!insp.open} aria-label="Details" />
        </div>
      </InspectorHostProvider>
    </div>
  );
}

export function moduleName(m: Module): string {
  return MODULE[m].name;
}

function SpendMeter({ att }: { att: NonNullable<ReturnType<typeof useWorld>['attention']['data']> }) {
  // With the wallet's exposure (T14): today's money out against the signed limit, gold near it.
  const out = readLimits(att.exposure)?.meters.find((m) => m.key === 'out');
  if (out) {
    return (
      <div className={`tb-meter${out.near ? ' near' : ''}`} title={out.why}>
        <b>{out.value}</b><span>paid out today{out.of ? ` · ${out.of}` : ''}</span>
      </div>
    );
  }
  const sp = spendToday(att.wallet_spend_today_minor, att.wallet_spend_today_currency);
  return (
    <div className={`tb-meter ${sp.exact ? '' : 'unknown'}`} title={sp.why ?? 'What your agents committed today'}>
      <b>{sp.text}</b><span>spent today</span>
    </div>
  );
}

/** Idle-lock state. Locked: click opens the approval window, where Windows Hello unlocks. */
function ShellLock() {
  const w = useWorld();
  const open = useMutation('approval_open');
  const L = w.locked;
  return (
    <Btn sm className={`lockbtn ${L ? 'is-locked' : ''}`} aria-disabled={!L} onClick={() => { if (L) void open.run({ deal_id: null }); }}
      title={L ? 'Locked after 15 quiet minutes. You can still look around; approving money asks for Windows Hello. Click to unlock.'
        : 'Approvals lock after 15 quiet minutes, then ask for Windows Hello.'}>
      <LockGlyph locked={L} />{L ? 'Locked' : 'Unlocked'}
    </Btn>
  );
}
