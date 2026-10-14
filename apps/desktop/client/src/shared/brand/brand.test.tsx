import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { arcDash, DialStrip, KeyArt, KEY_ART_MODULES, Mark, Rosette, Seal, SEAL_STATES, stripBeads, Graticule } from './index';
import { degreeMarks, ringFill, ROSETTE_RINGS, ticks } from './geometry';

afterEach(cleanup);

describe('geometry', () => {
  it('draws n ticks, the first at 12 o\'clock', () => {
    const d = ticks(10, 20, 4);
    expect(d.match(/M/g)).toHaveLength(4);
    expect(d.startsWith('M0 -10L0 -20')).toBe(true);
  });
  it('fills the rosette rings one after another', () => {
    expect([0, 1, 2, 3].map((i) => ringFill(0.5, i, 4))).toEqual([1, 1, 0, 0]);
    expect(ringFill(0.375, 1, 4)).toBeCloseTo(0.5);
    expect(ringFill(2, 3, 4)).toBe(1);
    expect(ringFill(-1, 0, 4)).toBe(0);
  });
  it('labels the bezel every 30 degrees', () => {
    expect(degreeMarks(40).map((m) => m.label)).toEqual(['000', '030', '060', '090', '120', '150', '180', '210', '240', '270', '300', '330']);
  });
});

describe('Seal', () => {
  it('is one labelled image whose parts are hidden, for every state', () => {
    for (const s of SEAL_STATES) {
      const { unmount } = render(<Seal state={s} label={`Wallet ${s}`} />);
      const img = screen.getByRole('img', { name: `Wallet ${s}` });
      expect(img.getAttribute('data-s')).toBe(s);
      expect([...img.querySelectorAll('svg')].every((el) => el.getAttribute('aria-hidden') === 'true')).toBe(true);
      unmount();
    }
  });
  it('draws the deadline arc only while a deadline runs', () => {
    const { container, rerender } = render(<Seal state="needs" label="Needs you" />);
    expect(container.querySelector('.arc')).toBeNull();
    rerender(<Seal state="needs" label="Needs you" progress={0.25} />);
    expect(container.querySelector('.arc .lft')?.getAttribute('stroke-dasharray')).toBe('0.2500 1');
    expect(container.querySelector('.br-seal')?.hasAttribute('data-timed')).toBe(true);
  });
  it('clamps the arc and drops it for unknown values', () => {
    expect(arcDash(2)).toBe('1.0000 1');
    expect(arcDash(-1)).toBe('0.0000 1');
    expect(arcDash(null)).toBeNull();
    expect(arcDash(undefined)).toBeNull();
    expect(arcDash(Number.NaN)).toBeNull();
  });
  it('prints the microprint ring only when given, with an id unique per seal', () => {
    const { container } = render(<><Seal state="quiet" label="a" ring="sample data" /><Seal state="quiet" label="b" ring="sample data" /></>);
    const paths = [...container.querySelectorAll('textPath')];
    expect(paths).toHaveLength(2);
    const ids = paths.map((p) => p.getAttribute('href'));
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(container.querySelector(id ?? '#none')).not.toBeNull();
    expect(paths[0]?.textContent).toContain('sample data · ');
  });
});

describe('Rosette, Mark, Graticule', () => {
  it('the rosette is ornamental and fills its rings from progress', () => {
    const { container } = render(<Rosette progress={0.5} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    const rings = [...container.querySelectorAll('path[data-ring]')].map((p) => p.getAttribute('stroke-dashoffset'));
    expect(rings).toHaveLength(ROSETTE_RINGS.length);
    expect(rings).toEqual(['0', '0', '1', '1']);
  });
  it('the mark is hidden unless labelled', () => {
    const { container, rerender } = render(<Mark />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    rerender(<Mark label="The Table" />);
    expect(screen.getByRole('img', { name: 'The Table' })).toBeTruthy();
  });
  it('the ground is ornamental', () => {
    const { container } = render(<Graticule variant="grid" fixed />);
    const g = container.querySelector('.br-ground');
    expect(g?.getAttribute('aria-hidden')).toBe('true');
    expect(g?.getAttribute('data-variant')).toBe('grid');
  });
});

describe('KeyArt', () => {
  it('draws a labelled plate for each of the six modules, with pattern ids unique per plate', () => {
    expect(KEY_ART_MODULES).toHaveLength(6);
    const { container } = render(<>{KEY_ART_MODULES.map((m) => <KeyArt key={m} module={m} label={`Plate ${m}`} />)}</>);
    for (const m of KEY_ART_MODULES) {
      const img = screen.getByRole('img', { name: `Plate ${m}` });
      expect(img.getAttribute('data-m')).toBe(m);
      expect(img.querySelectorAll('path').length).toBeGreaterThan(8);
    }
    const ids = [...container.querySelectorAll('pattern, clipPath')].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('DialStrip', () => {
  it('splits beads into shown and a +n tail', () => {
    expect(stripBeads(['teal', 'gold', 'ok'], 2)).toEqual({ shown: ['teal', 'gold'], more: 1 });
    expect(stripBeads(['teal'], 8)).toEqual({ shown: ['teal'], more: 0 });
    expect(stripBeads(['teal'], -3)).toEqual({ shown: [], more: 1 });
  });
  it('is one labelled image with a segment per module', () => {
    const { container } = render(
      <DialStrip label="Your wallet: 4 deals, 1 needs you" max={2}
        items={[{ module: 'spend', beads: ['gold', 'teal', 'dashed'], waiting: true }, { module: 'book', beads: ['ok'] }]} />,
    );
    expect(screen.getByRole('img', { name: 'Your wallet: 4 deals, 1 needs you' })).toBeTruthy();
    const segs = container.querySelectorAll('.seg');
    expect(segs).toHaveLength(2);
    expect(segs[0]?.hasAttribute('data-waiting')).toBe(true);
    expect(segs[0]?.querySelectorAll('.bead')).toHaveLength(2);
    expect(segs[0]?.querySelector('.more')?.textContent).toBe('+1');
    expect(segs[1]?.querySelector('.bead.ok')).not.toBeNull();
  });
});
