// The common frame of a module layer (rebuild WP2.5). Every module page of the console is one
// <ModuleLayer>: on its summary the module's key-art plate, the ONE answer line (the layer's
// heading, focused going in), a "Your call" chip when a decision here waits for the owner (with
// what happens if they do nothing), at most one gold action, 3-4 summary cards that each open a
// nested detail view, an explanation behind a disclosure, and the page's own content (a list);
// with nothing to show, one calm line. On a detail view it hosts that view: its title as the
// heading and its body. Back, Escape and the crumbs are the console's chrome (a nested view never
// draws its own Back).
import type { CSSProperties, ReactNode } from 'react';
import type { Module } from '@bindings/Module';
import { IF_NOTHING, MODULE_ART_LABEL, MODULE_EMPTY, YOUR_CALL, yourCallLabel } from '../../../lib/words';
import { formatCount } from '../../../lib/data/counts';
import { KeyArt } from '../../../shared/brand';
import { MODULE } from '../../../shared/modules';
import { Disclosure } from '../../../shared/ui';
import { silenceParts } from '../home/model';
import { useModuleRoute } from '../viewNav';
import { useNeeds } from '../world';
import { useLayerNav } from './layers';
import { ModuleSummary, type ModuleCard } from './ModuleSummary';

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
  /** Above the answer; defaults to the module's long name. */
  kicker?: ReactNode;
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
  const view = route.view ? p.views?.[route.view] : undefined;

  if (view) {
    return (
      <div className={`ml ml-view mod-${p.module}`} style={style} data-view={route.view ?? undefined}>
        <header className="ml-vhead">
          <p className="kicker">{MODULE[p.module].name}</p>
          <h1 className="display cs-title" tabIndex={-1} data-layer-title="">{view.title}</h1>
          {view.sub ? <p className="ml-sub">{view.sub}</p> : null}
          {view.actions ? <div className="cs-acts">{view.actions}</div> : null}
        </header>
        <div className="ml-vbody">{view.render()}</div>
      </div>
    );
  }

  const nothing = !p.cards?.length && !p.children;
  return (
    <div className={`ml mod-${p.module}`} style={style}>
      <header className="ml-head">
        <div className="ml-say">
          <p className="kicker">{p.kicker ?? MODULE[p.module].long}</p>
          <h1 className="display cs-title" tabIndex={-1} data-layer-title="">{p.answer}</h1>
          {p.sub ? <p className="ml-sub">{p.sub}</p> : null}
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
        <KeyArt module={p.module} label={MODULE_ART_LABEL[p.module]} className="ml-art" />
      </header>
      {p.cards?.length ? <ModuleSummary cards={p.cards} /> : null}
      {p.children ? <div className="ml-body">{p.children}</div> : null}
      {nothing ? <p className="ml-empty">{p.empty ?? MODULE_EMPTY}</p> : null}
      {p.explain ? <Disclosure summary={p.explain.summary} className="ml-explain">{p.explain.body}</Disclosure> : null}
    </div>
  );
}
