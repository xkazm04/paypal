// STAGE fork: the main column as the item's page. A breadcrumb "Today › <Module> › <title>" (Today
// goes back), then for a deal: the title with its figures (the deal page's own Summary), the answer in
// one sentence and the five milestones (deal/story.ts, deal/model.ts, Decision.tsx), "where it stands"
// (the row's cells under the module's column names plus the story's standing facts), "what happened"
// (the signed conversation and ledger moments, newest first, from deal_transcript) and the actions.
// A non-deal row shows its cells and its module's door. A panel the assistant showed renders with the
// board's own Answer renderers. Watch-only: the actions are approval_open and console doors.
import type { ReactNode } from 'react';
import type { Module } from '@bindings/Module';
import type { TranscriptStep } from '@bindings/TranscriptStep';
import { clockLabel, formatMoney } from '../../../../lib/format';
import { useQuery } from '../../../../lib/hooks';
import { BOARD_PANEL_TITLE, silenceWords } from '../../../../lib/words';
import { Glyph, MODULE } from '../../../../shared/modules';
import { Btn, Kv, Silence } from '../../../../shared/ui';
import { StateStrip, Summary } from '../../console/areas/deal/Decision';
import { mirrorStrip, stepWords, timelineRows } from '../../deal/model';
import { dealAnswer, standingFacts } from '../../deal/story';
import { formatHash, isTerminal } from '../../logic';
import type { GettingStarted } from '../../../../lib/firstRun';
import { Answer, type PanelHost } from '../../switchboard/Answer';
import { useCpLookup } from '../../ui';
import { useDisplayOf, useNeedOf, useWorldSelector } from '../../world';
import type { ModuleList, ModuleRow } from '../rows/rows';
import type { Open } from './nav';
import { SetupOverview } from './SetupInline';
import { GREET, STAGE } from './words';
import '../../console/areas/deal.css';

const STORY_SHOWN = 6;

export function ItemStage({ open, row, list, host, gs, onJump, onBack, below }: {
  open: Open;
  row: ModuleRow | null;
  list: ModuleList | null;
  host: PanelHost;
  gs: GettingStarted;
  onJump: Parameters<typeof SetupOverview>[0]['onJump'];
  onBack: () => void;
  /** The scoped questions and any suggested step, under the item. */
  below: ReactNode;
}) {
  if (open.kind === 'panel') {
    const p = open.spec;
    const mod: Module | null = p.kind === 'book' || p.kind === 'needs' || p.kind === 'rules' ? p.module : null;
    return (
      <article className="fs-item ar-deal-sheet" aria-label={STAGE.stageLabel(BOARD_PANEL_TITLE[p.kind])} data-stage={`panel:${p.kind}`}>
        <Crumb onBack={onBack} module={mod} title={BOARD_PANEL_TITLE[p.kind]} />
        <h1 className="fs-ititle">{BOARD_PANEL_TITLE[p.kind]}{mod ? <span className="fs-imod"> · {MODULE[mod].name}</span> : null}</h1>
        <div className="fs-panel">{p.kind === 'setup' ? <SetupOverview gs={gs} onJump={onJump} /> : <Answer panel={p} host={host} primary />}</div>
        {below}
      </article>
    );
  }
  if (!row) {
    return (
      <article className="fs-item" data-stage="gone">
        <Crumb onBack={onBack} module={open.module} title="" />
        <p className="fs-quiet">{STAGE.gone}</p>
      </article>
    );
  }
  // The row's own cells under the module's column names; a blank cell (a dash, nothing) is left out.
  const facts: [string, ReactNode][] = [];
  (list?.columns ?? []).forEach((c, i) => {
    const cell = row.cells[i];
    if (!cell || !cell.text.trim() || /^[–—-]$/.test(cell.text.trim())) return;
    facts.push([c, <span className={`${cell.num ? 'num' : ''}${cell.tone ? ` fs-tn-${cell.tone}` : ''}`}>{cell.text}</span>]);
  });
  return (
    <article className="fs-item ar-deal-sheet" aria-label={STAGE.stageLabel(row.title)} data-stage={`${row.module}:${row.id}`} style={{ '--mc': MODULE[row.module].cssVar } as React.CSSProperties}>
      <Crumb onBack={onBack} module={row.module} title={row.title} />
      {row.deal_id ? <DealStage id={row.deal_id} row={row} facts={facts} host={host} /> : (
        <>
          <header className="fs-ihead">
            <Glyph module={row.module} className="fs-iglyph" />
            <h1 className="fs-ititle">{row.title}</h1>
          </header>
          {row.sub ? <p className="fs-ianswer">{row.sub}</p> : null}
          {facts.length ? <section className="fs-isec"><h2 className="fs-kick">{STAGE.facts}</h2><Kv items={facts} className="fs-kv" /></section> : null}
          <p className="fs-quiet">{STAGE.notADeal}</p>
          <div className="fs-acts">
            <Btn onClick={() => host.run({ kind: 'console', hash: `#m=${row.module}` })}>{STAGE.openModule(MODULE[row.module].name)}</Btn>
          </div>
        </>
      )}
      {below}
    </article>
  );
}

function Crumb({ onBack, module, title }: { onBack: () => void; module: Module | null; title: string }) {
  return (
    <nav className="fs-crumb" aria-label={STAGE.back}>
      <button type="button" className="linkbtn fs-crumb-home" onClick={onBack} title={STAGE.back}>
        <span aria-hidden="true">‹ </span>{STAGE.today}
      </button>
      {module ? <><span className="fs-crumb-sep" aria-hidden="true">›</span><span>{MODULE[module].name}</span></> : null}
      {title ? <><span className="fs-crumb-sep" aria-hidden="true">›</span><span className="fs-crumb-t" aria-current="page">{title}</span></> : null}
      <kbd className="fs-esc" aria-hidden="true">Esc</kbd>
    </nav>
  );
}

function DealStage({ id, row, facts, host }: { id: string; row: ModuleRow; facts: [string, ReactNode][]; host: PanelHost }) {
  const deal = useWorldSelector((w) => w.dealById.get(id));
  const need = useNeedOf(id);
  const disp = useDisplayOf(id);
  const cp = useCpLookup()(deal?.counterparty ?? '');
  const tr = useQuery('deal_transcript', { deal_id: id }, { refreshOn: ['deal:changed'] });
  const k = host.model.byId.get(id);
  if (!deal) return <p className="fs-quiet">{STAGE.gone}</p>;

  const them = cp.name.split(' · ')[0] ?? cp.name;
  const steps: TranscriptStep[] | undefined = tr.data ?? undefined;
  const latest = (steps ?? []).reduce<TranscriptStep | null>((a, s) => (!a || s.seq > a.seq ? s : a), null);
  const strip = mirrorStrip(deal, { needsYou: !!need });
  const deadline = need?.deadline ?? disp?.deadline ?? null;
  const answer = dealAnswer(deal, { need, them, latest, band: null, mayWithdraw: false, check: null });
  const standing = standingFacts(deal, disp?.band ?? null, latest, them, null, steps).map((f) => [f.k, <span className={f.tone ? `fs-tn-${f.tone}` : ''}>{f.v}</span>] as [string, ReactNode]);
  const story = steps ? timelineRows(steps, deal) : [];
  const silence = k?.on_silence ?? (!isTerminal(deal) ? disp?.on_silence ?? null : null);

  return (
    <>
      <header className="fs-ihead">
        <Glyph module={row.module} className="fs-iglyph" />
        <h1 className="fs-ititle">{row.title}</h1>
        <div className="fs-ifigs"><Summary deal={deal} strip={strip} deadline={deadline} /></div>
      </header>
      <p className={`fs-ianswer tone-${answer.tone}`}><b>{answer.title}</b>{answer.sub ? <> {answer.sub}</> : null}</p>
      <StateStrip strip={strip} />
      {silence ? <p className="fs-isilence"><Silence text={silenceWords(silence)} deadline={deadline} /></p> : null}
      <div className="fs-acts">
        {k?.review ? (
          <Btn kind="gold" locked={host.locked} disabled={host.pending} onClick={() => host.run({ kind: 'approval', deal_id: id, target: null })}>{GREET.review}</Btn>
        ) : null}
        <Btn kind={k?.review ? 'plain' : 'default'} title={STAGE.openFullTitle} onClick={() => host.run({ kind: 'console', hash: formatHash({ level: 'deal', deal: id }) })}>{STAGE.openFull}</Btn>
      </div>
      <div className="fs-igrid">
        <section className="fs-isec" aria-label={STAGE.story}>
          <h2 className="fs-kick">{STAGE.story}</h2>
          {tr.error ? <p className="fs-quiet">{STAGE.storyUnread}</p> : !steps ? <p className="fs-quiet">{STAGE.storyReading}</p> : (
            <ol className="fs-story">
              {story.slice(0, STORY_SHOWN).map((r) => {
                const said = r.kind === 'env' ? (() => { const w = stepWords(r.step, them); return `${w.who} ${w.verb}`; })() : r.text;
                return (
                  <li key={r.key} className={r.kind === 'env' ? `is-${r.step.by === 'you' ? 'you' : 'them'}` : 'is-ledger'}>
                    <span className="fs-when num">{clockLabel(r.at)}</span>
                    <span className="fs-said">{said}</span>
                    {r.kind === 'env' && r.step.price ? <span className="fs-price num">{formatMoney(r.step.price)}</span> : <span />}
                  </li>
                );
              })}
              {story.length > STORY_SHOWN ? <li className="is-more"><span /><span className="fs-said">{STAGE.storyMore(story.length - STORY_SHOWN)}</span><span /></li> : null}
              {story.length === 0 ? <li className="is-ledger"><span /><span className="fs-said">{STAGE.storyNone}</span><span /></li> : null}
            </ol>
          )}
        </section>
        <section className="fs-isec" aria-label={STAGE.facts}>
          <h2 className="fs-kick">{STAGE.facts}</h2>
          <Kv items={[...facts, ...standing]} className="fs-kv" />
        </section>
      </div>
    </>
  );
}
