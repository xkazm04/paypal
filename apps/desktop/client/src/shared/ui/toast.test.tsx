// Toast dwell (toasts-notifications / queue-discipline): attention pauses the clock, and every
// dwell timer is owned by its toast, so nothing fires after the toast or its window is gone.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOAST_BAD_MS, TOAST_MS, ToastProvider, useToast, type ToastTone } from './toast';

function Pusher({ text, tone }: { text: string; tone?: ToastTone }) {
  const push = useToast();
  return <button type="button" onClick={() => push(text, tone)}>push</button>;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe('toast dwell', () => {
  it('goes after its dwell; a refusal stays longer', () => {
    render(<ToastProvider><Pusher text="Saved" /><Pusher text="Refused" tone="bad" /></ToastProvider>);
    const [ok, bad] = screen.getAllByRole('button');
    fireEvent.click(ok!);
    fireEvent.click(bad!);
    wait(TOAST_MS + 10);
    expect(screen.queryByText('Saved')).toBeNull();
    expect(screen.getByText('Refused')).toBeTruthy();
    wait(TOAST_BAD_MS - TOAST_MS);
    expect(screen.queryByText('Refused')).toBeNull();
  });

  it('a toast under the pointer or holding focus stays; leaving gives a fresh dwell', () => {
    render(<ToastProvider><Pusher text="Moved to the back" /></ToastProvider>);
    fireEvent.click(screen.getByRole('button'));
    const toast = screen.getByText('Moved to the back');
    wait(TOAST_MS - 500);
    fireEvent.mouseEnter(toast);
    wait(TOAST_MS * 3);
    expect(screen.getByText('Moved to the back')).toBeTruthy();
    fireEvent.mouseLeave(toast);
    wait(TOAST_MS - 100);
    expect(screen.getByText('Moved to the back')).toBeTruthy();
    fireEvent.focus(toast);
    wait(TOAST_MS * 2);
    expect(screen.getByText('Moved to the back')).toBeTruthy();
    fireEvent.blur(toast);
    wait(TOAST_MS + 10);
    expect(screen.queryByText('Moved to the back')).toBeNull();
  });

  it('leaves no timer behind when the window’s provider goes away', () => {
    const r = render(<ToastProvider><Pusher text="Saved" /></ToastProvider>);
    fireEvent.click(screen.getByRole('button'));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    r.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
