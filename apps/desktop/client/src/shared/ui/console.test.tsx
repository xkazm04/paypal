import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setCalm } from '../../design/motion';
import { Crumbs } from './components';
import { Depth, Facts, FilterChips, ListShell, ModuleTab, nextTab, pileCount, shownCount, Stack, TabStrip, toggleFilter } from './console';
import { Presence } from './Presence';

afterEach(() => { cleanup(); setCalm(false); vi.useRealTimers(); });

describe('unknown numbers', () => {
  it('are a dash, never zero', () => {
    expect(shownCount(null)).toBe('–');
    expect(shownCount(undefined)).toBe('–');
    expect(shownCount(Number.NaN)).toBe('–');
    expect(shownCount(0)).toBe('0');
    expect(shownCount(12)).toBe('12');
  });
});

describe('Stack', () => {
  it('is a named region with its pile drawn behind, capped at three sheets', () => {
    expect([pileCount(undefined), pileCount(-1), pileCount(2), pileCount(9)]).toEqual([0, 0, 2, 3]);
    const { container } = render(<Stack label="Spend" depth={5} gold tabs={<span>tabs</span>} corner={<span>seal</span>}>body</Stack>);
    const region = screen.getByRole('region', { name: 'Spend' });
    expect(region.getAttribute('data-depth')).toBe('3');
    const pile = container.querySelector('.ui-stack-pile');
    expect(pile?.getAttribute('aria-hidden')).toBe('true');
    expect(pile?.querySelectorAll('.psheet')).toHaveLength(3);
    expect(pile?.classList.contains('gold')).toBe(true);
    expect(region.textContent).toContain('body');
  });
  it('draws no pile at depth 0', () => {
    const { container } = render(<Stack label="Centre">x</Stack>);
    expect(container.querySelector('.ui-stack-pile')).toBeNull();
  });
});

describe('TabStrip and ModuleTab', () => {
  function Strip() {
    const [on, setOn] = useState('tables');
    return (
      <TabStrip label="Modules">
        {(['tables', 'spend', 'book'] as const).map((k, i) => (
          <ModuleTab key={k} label={k} active={on === k} onSelect={() => setOn(k)} count={i === 2 ? null : i * 3} waiting={i === 1 ? 2 : 0} waitingLabel={i === 1 ? '2 need you' : undefined} />
        ))}
      </TabStrip>
    );
  }
  it('is a tablist with one selected, focusable tab', () => {
    render(<Strip />);
    const tabs = screen.getAllByRole('tab');
    expect(screen.getByRole('tablist', { name: 'Modules' })).toBeTruthy();
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
  });
  it('arrows, Home and End move focus; a click selects', () => {
    render(<Strip />);
    const tabs = screen.getAllByRole('tab');
    tabs[0]?.focus();
    fireEvent.keyDown(tabs[0] as HTMLElement, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tabs[2]);
    fireEvent.keyDown(tabs[2] as HTMLElement, { key: 'Home' });
    expect(document.activeElement).toBe(tabs[0]);
    fireEvent.keyDown(tabs[0] as HTMLElement, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[1]);
    fireEvent.click(tabs[1] as HTMLElement);
    expect(screen.getAllByRole('tab')[1]?.getAttribute('aria-selected')).toBe('true');
  });
  it('shows the waiting badge with words for screen readers, and an unknown count as a dash', () => {
    render(<Strip />);
    const [, spend, book] = screen.getAllByRole('tab');
    expect(spend?.textContent).toContain('2 need you');
    expect(book?.querySelector('.tt')?.textContent).toBe('–');
    expect(book?.querySelector('.cnt')).toBeNull();
  });
  it('nextTab wraps and ignores other keys', () => {
    expect(nextTab('ArrowRight', 2, 3)).toBe(0);
    expect(nextTab('ArrowLeft', 0, 3)).toBe(2);
    expect(nextTab('End', 0, 3)).toBe(2);
    expect(nextTab('a', 0, 3)).toBeNull();
    expect(nextTab('ArrowRight', 0, 0)).toBeNull();
  });
});

describe('FilterChips', () => {
  it('toggles in multi mode and picks one in single mode', () => {
    expect(toggleFilter(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(toggleFilter(['a', 'b'], 'a', true)).toEqual(['b']);
    expect(toggleFilter(['a'], 'b', false)).toEqual(['b']);
    expect(toggleFilter(['a'], 'a', false)).toEqual([]);
  });
  it('is a group of pressed buttons with counts', () => {
    const onChange = vi.fn();
    render(<FilterChips label="Show" value={['held']} onChange={onChange} options={[{ value: 'held', label: 'Held', count: 3 }, { value: 'paid', label: 'Paid', count: null }]} />);
    const [held, paid] = screen.getAllByRole('button');
    expect(screen.getByRole('group', { name: 'Show' })).toBeTruthy();
    expect(held?.getAttribute('aria-pressed')).toBe('true');
    expect(paid?.getAttribute('aria-pressed')).toBe('false');
    expect(paid?.textContent).toContain('–');
    fireEvent.click(paid as HTMLElement);
    expect(onChange).toHaveBeenCalledWith(['held', 'paid']);
  });
});

describe('Facts', () => {
  it('lists label and value, dashing an unknown value', () => {
    const { container } = render(<Facts label="Facts" items={[{ key: 'a', k: 'Amount', v: '$64.00', tone: 'gold', num: true }, { key: 'm', k: 'Market', v: null }]} />);
    const facts = container.querySelectorAll('.ui-fact');
    expect(facts).toHaveLength(2);
    expect(facts[0]?.querySelector('dt')?.textContent).toBe('Amount');
    expect(facts[0]?.querySelector('dd')?.textContent).toBe('$64.00');
    expect(facts[1]?.classList.contains('unknown')).toBe(true);
    expect(facts[1]?.querySelector('dd')?.textContent).toBe('–');
  });
});

describe('ListShell', () => {
  it('renders the rows slot when given, children otherwise, and the empty state when empty', () => {
    const { rerender } = render(<ListShell label="Deals" search={<input aria-label="Find" />} summary="2 of 9" renderRows={() => <p>windowed</p>}>plain</ListShell>);
    const region = screen.getByRole('region', { name: 'Deals' });
    expect(region.textContent).toContain('windowed');
    expect(region.textContent).not.toContain('plain');
    expect(region.textContent).toContain('2 of 9');
    rerender(<ListShell label="Deals">plain</ListShell>);
    expect(screen.getByRole('region', { name: 'Deals' }).textContent).toContain('plain');
    rerender(<ListShell label="Deals" isEmpty empty="No deals yet">plain</ListShell>);
    expect(screen.getByRole('region', { name: 'Deals' }).textContent).toBe('No deals yet');
  });
});

describe('Depth and Crumbs', () => {
  it('lights as many bars as the depth, ornamental unless labelled', () => {
    const { container } = render(<Depth value={2} />);
    const el = container.querySelector('.ui-depth');
    expect(el?.getAttribute('aria-hidden')).toBe('true');
    expect(el?.querySelectorAll('i.on')).toHaveLength(2);
    expect(el?.querySelectorAll('i')).toHaveLength(4);
  });
  it('Crumbs keeps its API and adds the bars only when asked', () => {
    const { container, rerender } = render(<Crumbs items={[{ label: 'Home', onClick: () => {} }, { label: 'Spend' }]} />);
    expect(container.querySelector('.ui-depth')).toBeNull();
    expect(screen.getByText('Spend').getAttribute('aria-current')).toBe('page');
    rerender(<Crumbs items={[{ label: 'Home' }]} depth={1} />);
    expect(container.querySelectorAll('.ui-depth i.on')).toHaveLength(1);
  });
});

describe('Presence', () => {
  it('keeps children through the exit, then unmounts', () => {
    vi.useFakeTimers();
    const { rerender, container } = render(<Presence show exitMs={200}><p>sheet</p></Presence>);
    expect(container.querySelector('.ui-presence')?.getAttribute('data-state')).toBe('open');
    rerender(<Presence show={false} exitMs={200}><p>sheet</p></Presence>);
    expect(container.querySelector('.ui-presence')?.getAttribute('data-state')).toBe('closing');
    act(() => { vi.advanceTimersByTime(199); });
    expect(container.textContent).toBe('sheet');
    act(() => { vi.advanceTimersByTime(2); });
    expect(container.textContent).toBe('');
  });
  it('unmounts at once when motion is calm, and mounts again on show', () => {
    setCalm(true);
    const { rerender, container } = render(<Presence show><p>sheet</p></Presence>);
    rerender(<Presence show={false}><p>sheet</p></Presence>);
    expect(container.textContent).toBe('');
    rerender(<Presence show><p>sheet</p></Presence>);
    expect(container.textContent).toBe('sheet');
  });
  it('renders nothing when it starts hidden', () => {
    const { container } = render(<Presence show={false}><p>sheet</p></Presence>);
    expect(container.textContent).toBe('');
  });
});
