import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOLD_MS, setCalm } from '../../design/motion';
import { HoldGesture, holdPhaseWord, shownProgress } from './HoldGesture';

// The seal rule: only a full, unbroken hold completes, and completing only calls onComplete.
// Enter, a click, a short press, leaving, losing focus and a disabled seal never do.
describe('HoldGesture', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] }));
  afterEach(() => {
    cleanup();
    setCalm(false);
    vi.useRealTimers();
  });

  const setup = (props: { disabled?: boolean; ms?: number } = {}) => {
    const onComplete = vi.fn();
    const r = render(
      <HoldGesture label="Approve $64.00" onComplete={onComplete} hint="Press and hold to approve" progressLabel="Hold progress"
        holdingText="Keep holding" doneText="Confirmed" {...props} />,
    );
    return { onComplete, btn: screen.getByRole('button'), bar: screen.getByRole('progressbar'), rerender: r.rerender };
  };
  const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

  it('defaults to the 1200 ms hold', () => {
    const { onComplete, btn } = setup();
    fireEvent.pointerDown(btn, { button: 0 });
    wait(HOLD_MS - 100);
    expect(onComplete).not.toHaveBeenCalled();
    wait(200);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('Enter never completes, however long it is held', () => {
    const { onComplete, btn } = setup();
    const down = fireEvent.keyDown(btn, { key: 'Enter' });
    wait(HOLD_MS * 3);
    fireEvent.keyUp(btn, { key: 'Enter' });
    expect(down).toBe(false); // default prevented
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('a click never completes', () => {
    const { onComplete, btn } = setup();
    fireEvent.click(btn);
    wait(HOLD_MS * 3);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('a short pointer press and a short Space press never complete', () => {
    const { onComplete, btn } = setup();
    fireEvent.pointerDown(btn, { button: 0 });
    wait(HOLD_MS / 2);
    fireEvent.pointerUp(btn);
    fireEvent.keyDown(btn, { key: ' ' });
    wait(HOLD_MS / 3);
    fireEvent.keyUp(btn, { key: ' ' });
    wait(HOLD_MS * 3);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('a right-button press does nothing', () => {
    const { onComplete, btn, bar } = setup();
    fireEvent.pointerDown(btn, { button: 2 });
    wait(HOLD_MS * 2);
    expect(onComplete).not.toHaveBeenCalled();
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
  });

  it('leaving the seal or losing focus mid-hold cancels it', () => {
    const { onComplete, btn } = setup();
    fireEvent.pointerDown(btn, { button: 0 });
    wait(HOLD_MS / 2);
    fireEvent.pointerLeave(btn);
    wait(HOLD_MS * 2);
    fireEvent.keyDown(btn, { key: ' ' });
    wait(HOLD_MS / 2);
    fireEvent.blur(btn);
    wait(HOLD_MS * 2);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('a full held Space completes once and a second hold does not fire again', () => {
    const { onComplete, btn } = setup();
    fireEvent.keyDown(btn, { key: ' ' });
    fireEvent.keyDown(btn, { key: ' ', repeat: true });
    wait(HOLD_MS + 50);
    fireEvent.keyUp(btn, { key: ' ' });
    expect(onComplete).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(btn, { button: 0 });
    wait(HOLD_MS * 2);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(btn.getAttribute('data-phase')).toBe('sealed');
  });

  it('a disabled seal never completes, and re-enabling re-arms it', () => {
    const { onComplete, btn, rerender } = setup({ disabled: true });
    fireEvent.pointerDown(btn, { button: 0 });
    fireEvent.keyDown(btn, { key: ' ' });
    wait(HOLD_MS * 2);
    expect(onComplete).not.toHaveBeenCalled();
    rerender(<HoldGesture label="Approve $64.00" onComplete={onComplete} hint="h" progressLabel="Hold progress" holdingText="Keep holding" doneText="Confirmed" />);
    fireEvent.pointerDown(screen.getByRole('button'), { button: 0 });
    wait(HOLD_MS + 50);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('reports progress on the gauge and one phase word, never a running number', () => {
    const { btn, bar } = setup();
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    fireEvent.pointerDown(btn, { button: 0 });
    wait(HOLD_MS / 2);
    const mid = Number(bar.getAttribute('aria-valuenow'));
    expect(mid).toBeGreaterThan(30);
    expect(mid).toBeLessThan(70);
    expect(btn.querySelector('[aria-live]')?.textContent).toBe('Keep holding');
    wait(HOLD_MS);
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
    expect(btn.querySelector('[aria-live]')?.textContent).toBe('Confirmed');
  });

  it('a released hold drains back to empty', () => {
    const { btn, bar } = setup();
    fireEvent.pointerDown(btn, { button: 0 });
    wait(HOLD_MS / 2);
    fireEvent.pointerUp(btn);
    wait(1000);
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
    expect(btn.getAttribute('data-phase')).toBe('idle');
  });

  it('calm motion keeps the full hold time but fills in quarter steps', () => {
    setCalm(true);
    const { onComplete, btn, bar } = setup();
    fireEvent.pointerDown(btn, { button: 0 });
    wait(HOLD_MS * 0.6);
    expect(bar.getAttribute('aria-valuenow')).toBe('50');
    expect(onComplete).not.toHaveBeenCalled();
    wait(HOLD_MS * 0.5);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe('hold helpers', () => {
  it('phase words', () => {
    expect(holdPhaseWord('idle', 'Keep holding', 'Confirmed')).toBe('');
    expect(holdPhaseWord('holding', 'Keep holding', 'Confirmed')).toBe('Keep holding');
    expect(holdPhaseWord('sealed', 'Keep holding', 'Confirmed')).toBe('Confirmed');
  });
  it('shown progress clamps, and steps by quarters when calm', () => {
    expect(shownProgress(-1, false)).toBe(0);
    expect(shownProgress(2, false)).toBe(1);
    expect(shownProgress(0.6, false)).toBeCloseTo(0.6);
    expect(shownProgress(0.6, true)).toBe(0.5);
    expect(shownProgress(0.24, true)).toBe(0);
    expect(shownProgress(1, true)).toBe(1);
  });
});
