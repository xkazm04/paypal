import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoldButton } from './hold';

// The hold rule: only a full, unbroken hold confirms. Enter, a click and a short press never do.
describe('HoldButton', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] }));
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const MS = 1000;
  const setup = (props: { disabled?: boolean } = {}) => {
    const onConfirm = vi.fn();
    render(<HoldButton ms={MS} onConfirm={onConfirm} {...props}>Approve $64.00</HoldButton>);
    return { onConfirm, btn: screen.getByRole('button') };
  };
  const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

  it('Enter never confirms, however long it is held', () => {
    const { onConfirm, btn } = setup();
    const down = fireEvent.keyDown(btn, { key: 'Enter' });
    wait(MS * 3);
    fireEvent.keyUp(btn, { key: 'Enter' });
    expect(down).toBe(false); // default prevented
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('a click never confirms', () => {
    const { onConfirm, btn } = setup();
    fireEvent.click(btn);
    wait(MS * 3);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('a short press never confirms', () => {
    const { onConfirm, btn } = setup();
    fireEvent.pointerDown(btn, { button: 0 });
    wait(MS / 2);
    fireEvent.pointerUp(btn);
    wait(MS * 3);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('a short Space press never confirms', () => {
    const { onConfirm, btn } = setup();
    fireEvent.keyDown(btn, { key: ' ' });
    wait(MS / 2);
    fireEvent.keyUp(btn, { key: ' ' });
    wait(MS * 3);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('leaving the button mid-hold cancels it', () => {
    const { onConfirm, btn } = setup();
    fireEvent.pointerDown(btn, { button: 0 });
    wait(MS / 2);
    fireEvent.pointerLeave(btn);
    wait(MS * 3);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('a full pointer hold confirms once', () => {
    const { onConfirm, btn } = setup();
    fireEvent.pointerDown(btn, { button: 0 });
    wait(MS + 100);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(btn);
    fireEvent.pointerDown(btn, { button: 0 });
    wait(MS * 3);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('a full held Space confirms once', () => {
    const { onConfirm, btn } = setup();
    fireEvent.keyDown(btn, { key: ' ' });
    wait(MS + 100);
    fireEvent.keyUp(btn, { key: ' ' });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('a disabled button never confirms', () => {
    const { onConfirm, btn } = setup({ disabled: true });
    fireEvent.pointerDown(btn, { button: 0 });
    fireEvent.keyDown(btn, { key: ' ' });
    wait(MS * 3);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
