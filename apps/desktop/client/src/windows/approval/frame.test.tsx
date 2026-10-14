// The approval window as a layer of the console (rebuild WP4b): its bar names where it sits, the
// Approvals strip says what it is, and "Back to The Table" only closes the window: it never calls a
// wallet command (nothing is decided, released or withdrawn). The hold keeps its rule with the new face.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APPROVAL_FRAME, BRAND_NAME, HOLD_WORDS } from '../../lib/words';
import { CALM_STORE_KEY } from '../../design/motion';
import { CALM_KEY } from '../main/console/calm';

const hoisted = vi.hoisted(() => ({ kind: 'mock' as 'mock' | 'tauri', invoke: vi.fn(), close: vi.fn(async () => {}) }));
vi.mock('../../lib/runtime', () => ({ backend: () => ({ kind: hoisted.kind, invoke: hoisted.invoke, listen: vi.fn() }) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ close: hoisted.close }) }));

const { WindowBar, closeThisWindow } = await import('./ui');
const { ToastProvider, HoldButton } = await import('../../shared/ui');

afterEach(() => {
  cleanup();
  hoisted.invoke.mockClear();
  hoisted.close.mockClear();
  hoisted.kind = 'mock';
});

describe('the approval window’s bar', () => {
  it('names where it sits and what it is', () => {
    render(<ToastProvider><WindowBar mode="sandbox" module="Tables" /></ToastProvider>);
    const crumbs = screen.getByRole('navigation', { name: APPROVAL_FRAME.crumbs });
    expect(crumbs.textContent).toBe(`${BRAND_NAME}›${APPROVAL_FRAME.name}›Tables`);
    expect(document.querySelector('.aw-tab')?.textContent).toBe(`${APPROVAL_FRAME.name}: ${APPROVAL_FRAME.strip}`);
  });

  it('Back to The Table in the preview says so and calls no wallet command', async () => {
    render(<ToastProvider><WindowBar mode="sandbox" /></ToastProvider>);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Back to The Table/ })); });
    expect(await screen.findByText(APPROVAL_FRAME.closePreview)).toBeTruthy();
    expect(hoisted.invoke).not.toHaveBeenCalled();
    expect(hoisted.close).not.toHaveBeenCalled();
  });

  it('in the app it closes this window only, the same close path as “Close this window”', async () => {
    hoisted.kind = 'tauri';
    expect(await closeThisWindow()).toBeNull();
    expect(hoisted.close).toHaveBeenCalledTimes(1);
    expect(hoisted.invoke).not.toHaveBeenCalled();
    hoisted.close.mockRejectedValueOnce(new Error('denied'));
    expect(await closeThisWindow()).toBe(APPROVAL_FRAME.closeFailed);
  });

  it('the DealReview close path uses it (one close path for the window)', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/windows/approval/DealReview.tsx'), 'utf8');
    expect(src).toContain('await closeThisWindow()');
    expect(src).not.toContain('getCurrentWindow');
  });
});

describe('the hold’s new face', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  it('keeps the ui-hold class, shows a gauge, and confirms once only after the full hold', () => {
    const onConfirm = vi.fn();
    render(<HoldButton onConfirm={onConfirm}>Hold to approve $64.00</HoldButton>);
    const btn = screen.getByRole('button');
    expect(btn.classList.contains('ui-hold')).toBe(true);
    expect(btn.textContent).toContain('Hold to approve $64.00');
    const gauge = screen.getByRole('progressbar', { name: HOLD_WORDS.progress });
    expect(gauge.getAttribute('aria-valuenow')).toBe('0');
    fireEvent.keyDown(btn, { key: ' ' });
    act(() => { vi.advanceTimersByTime(600); });
    expect(Number(gauge.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
    expect(onConfirm).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(700); });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('losing focus mid-hold cancels it', () => {
    const onConfirm = vi.fn();
    render(<HoldButton onConfirm={onConfirm}>Hold to pay</HoldButton>);
    const btn = screen.getByRole('button');
    fireEvent.keyDown(btn, { key: ' ' });
    act(() => { vi.advanceTimersByTime(600); });
    fireEvent.blur(btn);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('one app, one calm choice', () => {
  it('the approval window reads the key The Table writes', () => {
    expect(CALM_STORE_KEY).toBe(CALM_KEY);
  });
});
