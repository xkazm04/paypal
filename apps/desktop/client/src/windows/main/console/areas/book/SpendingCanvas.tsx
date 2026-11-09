// The spending chart's drawing surface: one bar series on a canvas. Colours are read from the design
// tokens, because a canvas cannot use CSS variables, and read again when the theme changes.
import { useEffect, useRef, useState } from 'react';
import { AgCharts, type AgCartesianChartOptions, type AgChartInstance } from 'ag-charts-community';
import { exponent, formatMinor } from '../../../../../lib/format';
import { BOOK } from '../../../../../lib/words';
import './ag-charts.css';
import type { SpendPoint, SpendSeries } from './spending';

type Palette = { bar: string; axis: string; grid: string; font: string };
function paletteOf(el: HTMLElement): Palette {
  const c = getComputedStyle(el);
  const get = (name: string) => c.getPropertyValue(name).trim();
  return { bar: get('--teal'), axis: get('--muted'), grid: get('--line'), font: get('--font') };
}

function optionsOf(s: SpendSeries, p: Palette, container: HTMLElement): AgCartesianChartOptions {
  const per = 10 ** exponent(s.currency);
  const money = (minor: number) => formatMinor(minor, s.currency);
  const data = s.points.map((x: SpendPoint) => ({ day: x.label, value: x.minor / per, minor: x.minor }));
  return {
    container,
    data,
    background: { visible: false },
    animation: { enabled: false },
    legend: { enabled: false },
    padding: { top: 8, right: 8, bottom: 0, left: 8 },
    series: [{
      type: 'bar', xKey: 'day', yKey: 'value', yName: BOOK.chart.label, fill: p.bar, strokeWidth: 0,
      tooltip: { renderer: (q) => ({ title: String(q.datum.day), content: money(Number(q.datum.minor)) }) },
    }],
    axes: [
      { type: 'category', position: 'bottom', label: { color: p.axis, fontFamily: p.font, wrapping: 'never', autoRotate: false, avoidCollisions: true }, line: { stroke: p.grid }, tick: { stroke: p.grid } },
      { type: 'number', position: 'left', nice: true, min: 0, label: { color: p.axis, fontFamily: p.font, formatter: (q) => money(Math.round(Number(q.value) * per)) }, gridLine: { style: [{ stroke: p.grid }] }, line: { width: 0 } },
    ],
  } as AgCartesianChartOptions;
}

export default function SpendingCanvas({ series }: { series: SpendSeries }) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<AgChartInstance | null>(null);
  // A theme change repaints the canvas: tokens are read again.
  const [themeTick, setThemeTick] = useState(0);
  useEffect(() => {
    const seen = new MutationObserver(() => setThemeTick((n) => n + 1));
    seen.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => seen.disconnect();
  }, []);
  useEffect(() => () => { chart.current?.destroy(); chart.current = null; }, []);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const options = optionsOf(series, paletteOf(el), el);
    if (chart.current) void chart.current.update(options);
    else chart.current = AgCharts.create(options);
  }, [series, themeTick]);
  return <div ref={host} className="bk-chart-canvas" role="img" aria-label={`${BOOK.chart.label}: ${BOOK.chart.total(formatMinor(series.total, series.currency))}`} />;
}
