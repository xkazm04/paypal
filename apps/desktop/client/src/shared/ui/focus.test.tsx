import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { focusLost, modalFocusTarget, shouldRescue, useFocusRescue } from './focus';
import { holdWord } from './hold';
import { resetLayersForTest } from './layers';
import { Sheet } from './Sheet';
import { whyName } from './why';

describe('modal focus guard', () => {
  beforeEach(() => resetLayersForTest());
  afterEach(() => cleanup());

  function Page({ open }: { open: boolean }) {
    return (
      <>
        <button type="button">Behind the scrim</button>
        <div data-layer-free=""><button type="button">In a popover</button></div>
        {open ? <Sheet title="Release the hold?" onClose={() => {}} footer={<button type="button">Keep it</button>}>body</Sheet> : null}
      </>
    );
  }

  it('does nothing while no modal is open', () => {
    render(<Page open={false} />);
    const behind = screen.getByRole('button', { name: 'Behind the scrim' });
    expect(modalFocusTarget(behind)).toBeNull();
    act(() => behind.focus());
    expect(document.activeElement).toBe(behind);
  });

  it('pulls focus that escapes behind an open sheet back to its heading, never to a button', () => {
    render(<Page open />);
    const heading = screen.getByRole('heading', { name: 'Release the hold?' });
    expect(document.activeElement).toBe(heading);
    const behind = screen.getByRole('button', { name: 'Behind the scrim' });
    expect(modalFocusTarget(behind)).toBe(heading);
    act(() => behind.focus());
    expect(document.activeElement).toBe(heading);
  });

  it('leaves focus inside the sheet and inside layer-free popovers alone', () => {
    render(<Page open />);
    const keep = screen.getByRole('button', { name: 'Keep it' });
    expect(modalFocusTarget(keep)).toBeNull();
    expect(modalFocusTarget(screen.getByRole('button', { name: 'In a popover' }))).toBeNull();
  });

  it('the sheet box itself takes focus on a click into plain text (tabIndex -1)', () => {
    render(<Page open />);
    expect(screen.getByRole('dialog').getAttribute('tabindex')).toBe('-1');
  });

  it('stops guarding once the sheet closes', () => {
    const { rerender } = render(<Page open />);
    rerender(<Page open={false} />);
    const behind = screen.getByRole('button', { name: 'Behind the scrim' });
    expect(modalFocusTarget(behind)).toBeNull();
  });
});

describe('focus rescue', () => {
  afterEach(() => cleanup());

  it('rescues only when the focused element is gone and nothing has focus', () => {
    const gone = document.createElement('button');
    expect(focusLost()).toBe(true);
    expect(shouldRescue(gone)).toBe(true);
    expect(shouldRescue(null)).toBe(false);
    const here = document.createElement('button');
    document.body.append(here);
    expect(shouldRescue(here)).toBe(false);
    here.remove();
  });

  function Decision() {
    const head = useRef<HTMLHeadingElement>(null);
    const [decided, setDecided] = useState(false);
    useFocusRescue(head);
    return (
      <main>
        <h1 tabIndex={-1} ref={head}>Pay partsco $64.00?</h1>
        {decided ? <p role="status">Paid</p> : <button type="button" onClick={() => setDecided(true)}>Pay $64.00</button>}
      </main>
    );
  }

  it('puts focus on the heading when the decided button unmounts', () => {
    render(<Decision />);
    const pay = screen.getByRole('button', { name: 'Pay $64.00' });
    act(() => pay.focus());
    fireEvent.click(pay);
    expect(screen.queryByRole('button', { name: 'Pay $64.00' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Pay partsco $64.00?' }));
  });
});

describe('screen-reader words', () => {
  it('the hold button says one word per phase, never a running percentage', () => {
    expect(holdWord(false, 0)).toBe('');
    expect(holdWord(false, 0.01)).toBe('Keep holding');
    expect(holdWord(false, 0.73)).toBe('Keep holding');
    expect(holdWord(true, 1)).toBe('Confirmed');
  });

  it('a Why link is named by its visible word plus its question', () => {
    expect(whyName('Proof', 'Scam check: looks safe.')).toBe('Proof, Scam check: looks safe.');
    expect(whyName('Why?', '')).toBeUndefined();
    expect(whyName('Why?', <b>x</b>)).toBeUndefined();
  });
});
