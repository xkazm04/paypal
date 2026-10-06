import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeTopLayer, layerCount, pushLayer, resetLayersForTest, topLayerKind } from './layers';
import { Popover } from './Popover';
import { Sheet } from './Sheet';

const esc = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

describe('layer stack (pure)', () => {
  beforeEach(() => resetLayersForTest());

  it('Esc closes the topmost layer only', () => {
    const a = vi.fn();
    const b = vi.fn();
    pushLayer(a, 'sheet');
    pushLayer(b, 'popover');
    expect(layerCount()).toBe(2);
    expect(topLayerKind()).toBe('popover');
    esc();
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
    expect(layerCount()).toBe(1);
    esc();
    expect(a).toHaveBeenCalledTimes(1);
    expect(layerCount()).toBe(0);
  });

  it('an open layer consumes Esc before a bubble-phase window handler (App back-one-level)', () => {
    const back = vi.fn();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') back(); };
    window.addEventListener('keydown', k);
    try {
      const close = vi.fn();
      pushLayer(close, 'sheet');
      esc();
      expect(close).toHaveBeenCalledTimes(1);
      expect(back).not.toHaveBeenCalled();
      esc(); // no layer left: Esc reaches the page
      expect(back).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', k);
    }
  });

  it('removing a layer out of order keeps the others', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = pushLayer(a);
    pushLayer(b);
    offA();
    expect(layerCount()).toBe(1);
    expect(closeTopLayer()).toBe(true);
    expect(b).toHaveBeenCalled();
    expect(a).not.toHaveBeenCalled();
    expect(closeTopLayer()).toBe(false);
  });

  it('ignores other keys and IME composition', () => {
    const a = vi.fn();
    pushLayer(a);
    fireEvent.keyDown(document.body, { key: 'Enter' });
    fireEvent.keyDown(document.body, { key: 'Escape', isComposing: true });
    expect(a).not.toHaveBeenCalled();
  });
});

function Harness() {
  const [sheet, setSheet] = useState(true);
  const [pop, setPop] = useState<HTMLElement | null>(null);
  return (
    <>
      <button type="button">outside</button>
      {sheet ? (
        <Sheet title="Void the hold?" onClose={() => setSheet(false)} footer={<button type="button">Void hold</button>}>
          <button type="button" onClick={(e) => setPop(e.currentTarget)}>info</button>
          {pop ? <Popover anchor={pop} title="Clause 7" onClose={() => setPop(null)}><p>allowlist</p></Popover> : null}
        </Sheet>
      ) : null}
    </>
  );
}

describe('Sheet and Popover on the stack', () => {
  beforeEach(() => resetLayersForTest());
  afterEach(() => cleanup());

  it('a sheet focuses its heading, never a button', () => {
    render(<Harness />);
    expect(document.activeElement?.tagName).toBe('H2');
    expect(document.activeElement?.textContent).toBe('Void the hold?');
  });

  it('Esc closes the popover first, then the sheet', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('info'));
    expect(screen.getByText('allowlist')).toBeTruthy();
    expect(layerCount()).toBe(2);
    act(() => { esc(); });
    expect(screen.queryByText('allowlist')).toBeNull();
    expect(screen.getByText('Void the hold?')).toBeTruthy();
    act(() => { esc(); });
    expect(screen.queryByText('Void the hold?')).toBeNull();
    expect(layerCount()).toBe(0);
  });

  it('an outside click closes the popover but not the sheet', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('info'));
    act(() => { fireEvent.pointerDown(screen.getByText('Void hold')); });
    expect(screen.queryByText('allowlist')).toBeNull();
    expect(screen.getByText('Void the hold?')).toBeTruthy();
  });

  it('returns focus to where it was when the sheet closes', () => {
    function Opener() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>open</button>
          {open ? <Sheet title="Details" onClose={() => setOpen(false)}>body</Sheet> : null}
        </>
      );
    }
    render(<Opener />);
    const opener = screen.getByText('open');
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement?.textContent).toBe('Details');
    act(() => { esc(); });
    expect(document.activeElement).toBe(opener);
  });
});
