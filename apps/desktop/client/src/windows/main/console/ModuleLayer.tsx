// The common frame of a module layer (rebuild WP2.5). Every module page of the console is one
// <ModuleLayer>: on its summary the module's key-art plate, the ONE answer line (the layer's
// heading, focused going in), a "Your call" chip when a decision here waits for the owner (with
// what happens if they do nothing), at most one gold action, and on its right 3-4 small summary
// chips that each open a nested detail view, the module's key art faint behind it all), an explanation behind a disclosure, and the page's own content (a list);
// with nothing to show, one calm line. On a detail view it hosts that view: its title as the
// heading and its body. Back, Escape and the crumbs are the console's chrome (a nested view never
// draws its own Back).
import type { CSSProperties, ReactNode } from 'react';
import type { Module } from '@bindings/Module';
import { IF_NOTHING, MODULE_CRUMBS_LABEL, MODULE_EMPTY, MODULE_FINISH_SETUP, YOUR_CALL, yourCallLabel } from '../../../lib/words';
import { formatCount } from '../../../lib/data/counts';
import { KeyArt } from '../../../shared/brand';
import { MODULE } from '../../../shared/modules';
import { Disclosure } from '../../../shared/ui';
import { silenceParts } from '../home/model';
import { useModuleRoute } from '../viewNav';
import { useNeeds } from '../world';
import { useLayerNav, useLayerState } from './layers';
import { ContentCrumbs } from './CrumbTrail';
import { crumbItems } from './crumbItems';
import { Latest, LatestSkeleton, type LatestProps } from './Latest';
import { MAX_CARDS, ModuleSummary, type ModuleCard } from './ModuleSummary';
import { Staged, Skeleton } from './stagger';

/** A nested detail view of a module. */
export type ModuleViewDef = {
  /** The view's heading (the same words as its registered crumb label). */
  title: string;
  /** One line under the heading. */
  sub?: ReactNode;
  /** The view's one action (gold only when it hands a decision to the approval window). */
  actions?: ReactNode;
  render: () => ReactNode;
};

export type YourCall = { count: number; ifNothing: string | null; onOpen: () => void };

export type ModuleLayerProps = {
  module: Module;
  /** The one answer line: what this module says to the owner right now. */
  answer: ReactNode;
  /** Retired: the line above the answer is now the page's breadcrumb row. Accepted, not drawn. */
  kicker?: ReactNode;
  /** What this module does for the owner, in one permanent line under the answer. */
  purpose?: ReactNode;
  /** One line under the answer. */
  sub?: ReactNode;
  /** The decision chip. Defaults to the module's own open decisions (World needs); `null` hides it. */
  yourCall?: YourCall | null;
  /** The layer's one gold action, if it has one. */
  action?: ReactNode;
  cards?: readonly ModuleCard[];
  /** Why the module says what it says, one disclosure away. */
  explain?: { summary: ReactNode; body: ReactNode };
  /** The one calm line when there is nothing to show (no cards and no content). */
  empty?: ReactNode;
  /** The module's detail views by key (register their labels with `defineModuleViews`). */
  views?: Readonly<Record<string, ModuleViewDef>>;
  /** More of the summary under the cards (a ListEngine, a chart). */
  children?: ReactNode;
  /** The quiet "Latest" strip under the cards: the first rows of the module's most relevant list,
   *  sized to the room left on the sheet (Latest.tsx). */
  latest?: LatestProps;
};

/** The module's open decisions as the "Your call" chip: how many, and the first one's default. */
function useOwnCall(module: Module): YourCall | null {
  const needs = useNeeds();
  const nav = useLayerNav();
  const mine = needs.filter((n) => n.module === module);
  const first = mine[0];
  if (!first) return null;
  return { count: mine.length, ifNothing: silenceParts(first.on_silence).head, onOpen: () => nav.go({ level: 'waiting', module }) };
}

export function ModuleLayer(p: ModuleLayerProps) {
  const route = useModuleRoute();
  const own = useOwnCall(p.module);
  const call = p.yourCall === undefined ? own : p.yourCall;
  const style = { '--mc': MODULE[p.module].cssVar } as CSSProperties;
  const nav = useLayerNav();
  const { firstRun } = useLayerState();
  const view = route.view ? p.views?.[route.view] : undefined;
  // The page's own breadcrumb: the module, and its open view, from the same routes the top bar draws.
  const here = { level: 'module', module: p.module } as const;
  const crumbs = (
    <ContentCrumbs label={MODULE_CRUMBS_LABEL} title={MODULE[p.module].long}
      items={crumbItems(route.view ? [here, { ...here, view: route.view }] : [here], { back: () => route.open(null), go: nav.go })} />
  );

  if (view) {
    return (
      <div className={`ml ml-view mod-${p.module}`} style={style} data-view={route.view ?? undefined}>
        <header className="ml-vhead">
          {crumbs}
          <h1 className="display cs-title" tabIndex={-1} data-layer-title="">{view.title}</h1>
          {view.sub ? <p className="ml-sub">{view.sub}</p> : null}
          {view.actions ? <div className="cs-acts">{view.actions}</div> : null}
        </header>
        <Staged wave={1} sizeKey={`${p.module}:view:${route.view}`} skeleton={<Skeleton className="ml-vbody" h="16rem" />}>
          <div className="ml-vbody">{view.render()}</div>
        </Staged>
      </div>
    );
  }

  // The calm "nothing here" line only when nothing else is drawn (cards, content or a Latest strip).
  const nothing = !p.cards?.length && !p.children && !p.latest;
  return (
    <div className={`ml mod-${p.module}`} style={style}>
      <header className="ml-head">
        <KeyArt module={p.module} className="ml-art" />
        <div className="ml-say">
          {crumbs}
          <h1 className="display cs-title" tabIndex={-1} data-layer-title="">{p.answer}</h1>
          {p.purpose ? <p className="ml-purpose">{p.purpose}</p> : null}
          {p.sub ? <p className="ml-sub">{p.sub}</p> : null}
          {firstRun && !route.view ? <p className="ml-setup"><button type="button" className="ml-setup-btn" onClick={() => nav.setup()}>{MODULE_FINISH_SETUP.label}</button><span>{MODULE_FINISH_SETUP.why}</span></p> : null}
          {call || p.action ? (
            <div className="ml-calls">
              {call ? (
                <button type="button" className="ml-call" onClick={call.onOpen} data-fk="your-call" aria-label={yourCallLabel(call.count)}>
                  <span className="led" aria-hidden="true" />{YOUR_CALL}<b className="num">{formatCount(call.count)}</b>
                </button>
              ) : null}
              {call?.ifNothing ? <span className="ml-silence">{IF_NOTHING}: <b>{call.ifNothing}</b></span> : null}
              {p.action ? <span className="ml-action">{p.action}</span> : null}
            </div>
          ) : null}
        </div>
        {/* The answer, Your call and the action are wave 0 (stagger.tsx); the cards take their turn. */}
        {p.cards?.length ? (
          <Staged wave={1} sizeKey={`${p.module}:cards`} skeleton={<Skeleton className="ml-cards" blocks={Math.min(p.cards.length, MAX_CARDS)} block="ui-sumcard compact" style={{ '--n': Math.min(p.cards.length, MAX_CARDS) } as CSSProperties} />}>
            <ModuleSummary cards={p.cards} />
          </Staged>
        ) : null}
      </header>
      {p.latest ? <Staged wave={2} sizeKey={`${p.module}:latest`} skeleton={<LatestSkeleton {...p.latest} />}><Latest {...p.latest} /></Staged> : null}
      {p.children ? <Staged wave={2} sizeKey={`${p.module}:body`} skeleton={<Skeleton className="ml-body" h="8rem" />}><div className="ml-body">{p.children}</div></Staged> : null}
      {nothing ? <p className="ml-empty">{p.empty ?? MODULE_EMPTY}</p> : null}
      {p.explain ? <Staged wave={3} skeleton={<Skeleton className="ml-explain" blocks={1} />}><Disclosure summary={p.explain.summary} className="ml-explain">{p.explain.body}</Disclosure></Staged> : null}
    </div>
  );
}
