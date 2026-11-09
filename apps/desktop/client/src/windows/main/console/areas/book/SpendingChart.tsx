// The spending chart above the Book's ledger: what PayPal confirmed going out, one currency at a time,
// following the grid's filters. The chart itself is a separate chunk (./SpendingCanvas), loaded only here.
import { lazy, Suspense, useMemo, useState } from 'react';
import type { Currency } from '@bindings/Currency';
import type { Deal } from '@bindings/Deal';
import { formatMinor } from '../../../../../lib/format';
import { BOOK } from '../../../../../lib/words';
import { Seg } from '../../../../../shared/ui';
import { spendingSeries } from './spending';

const SpendingCanvas = lazy(() => import('./SpendingCanvas'));

export function SpendingChart({ rows, checking }: { rows: readonly Deal[]; checking: (d: Deal) => boolean }) {
  const series = useMemo(() => spendingSeries(rows, checking), [rows, checking]);
  const [picked, setPicked] = useState<Currency | null>(null);
  const line = series.find((s) => s.currency === picked) ?? series[0];
  if (!line) return <section className="bk-chart" aria-label={BOOK.chart.label}><p className="bk-chart-none">{BOOK.chart.none}</p></section>;
  return (
    <section className="bk-chart" aria-label={BOOK.chart.label}>
      <div className="bk-chart-head">
        <b>{BOOK.chart.label}</b>
        <span className="bk-dim">{line.byWeek ? BOOK.chart.byWeek : BOOK.chart.byDay}</span>
        <span className="ui-spacer" />
        <span className="bk-dim">{BOOK.chart.total(formatMinor(line.total, line.currency))}</span>
        {series.length > 1 ? <Seg label={BOOK.chart.currency} value={line.currency} onChange={(c: Currency) => setPicked(c)} options={series.map((s) => ({ value: s.currency, label: s.currency }))} /> : null}
      </div>
      {/* A surface without a canvas (a test's jsdom) keeps the figure above and draws nothing. */}
      {typeof Path2D === 'undefined' ? null : (
        <Suspense fallback={<p className="bk-chart-none" role="status">{BOOK.chart.reading}</p>}>
          <SpendingCanvas series={line} />
        </Suspense>
      )}
    </section>
  );
}
