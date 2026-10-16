import type { ReactNode } from 'react';

/** A quiet "show more": the native details element (keyboard and screen reader for free), styled by details.ui-disclosure. */
export function Disclosure({ summary, children, defaultOpen, className }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  return (
    <details className={`ui-disclosure${className ? ` ${className}` : ''}`} open={defaultOpen}>
      <summary>{summary}</summary>
      <div className="ui-disclosure-body">{children}</div>
    </details>
  );
}
