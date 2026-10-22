import { createContext, useContext, type ReactNode } from 'react';
import { DETAIL_BACK, UI_WORDS } from '../../lib/words';
import { Btn, PageHead } from './components';

/**
 * A nested page: a visible Back button, then the page head. The h1 takes focus when the page is
 * entered (it is never a button, so Enter cannot do anything by accident). One primary action per
 * page: put it in `actions`.
 */
/**
 * True inside a frame whose own chrome already draws Back (the main window's console: its top bar
 * walks the chain of layers, rebuild WP2.5). A DetailPage there draws no Back of its own, so a
 * nested page never shows two.
 */
export const ChromeBackContext = createContext(false);

export type DetailPageProps = {
  title: ReactNode;
  onBack: () => void;
  /** Where Back goes, shown as "‹ <backLabel>". Defaults to "Back". */
  backLabel?: string;
  icon?: ReactNode;
  sub?: ReactNode;
  info?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
};
export function DetailPage({ title, onBack, backLabel = DETAIL_BACK, icon, sub, info, actions, children, className }: DetailPageProps) {
  const chrome = useContext(ChromeBackContext);
  return (
    <section className={`ui-detail${className ? ` ${className}` : ''}`}>
      {chrome ? null : <div className="ui-detail-back"><Btn sm kind="plain" onClick={onBack} title={UI_WORDS.escHint(backLabel)}>‹ {backLabel}</Btn></div>}
      <PageHead title={title} icon={icon} sub={sub} info={info} actions={actions} focusKey="detail" />
      <div className="ui-detail-body">{children}</div>
    </section>
  );
}
