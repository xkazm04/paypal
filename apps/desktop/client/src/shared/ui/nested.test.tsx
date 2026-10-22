import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DetailPage } from './DetailPage';
import { Disclosure } from './Disclosure';
import { SummaryCard } from './SummaryCard';

afterEach(() => cleanup());

describe('SummaryCard', () => {
  it('is one button that opens, carries its id and names its action', () => {
    const open = vi.fn();
    render(<SummaryCard id="ledger" label="Ledger" value="12 deals" chip="2 need you" chipTone="gold" onOpen={open} />);
    const b = screen.getByRole('button', { name: /Ledger/ });
    expect(b.getAttribute('data-card')).toBe('ledger');
    expect(b.textContent).toContain('12 deals');
    expect(b.textContent).toContain('Open');
    fireEvent.click(b);
    expect(open).toHaveBeenCalledTimes(1);
    expect(b.tagName).toBe('BUTTON');
    expect(b.getAttribute('type')).toBe('button');
  });
});

describe('Disclosure', () => {
  it('starts closed, opens from its summary, and honours defaultOpen', () => {
    const { container } = render(<><Disclosure summary="More">hidden words</Disclosure><Disclosure summary="Open one" defaultOpen>shown</Disclosure></>);
    const [a, b] = Array.from(container.querySelectorAll('details'));
    expect(a?.open).toBe(false);
    expect(b?.open).toBe(true);
    expect(a?.classList.contains('ui-disclosure')).toBe(true);
    expect(screen.getByText('More').tagName).toBe('SUMMARY');
  });
});

describe('DetailPage', () => {
  it('focuses its h1 on mount and goes back from a visible button', () => {
    const back = vi.fn();
    render(<DetailPage title="Ledger" onBack={back} backLabel="Book">body</DetailPage>);
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Ledger' }));
    fireEvent.click(screen.getByRole('button', { name: /Book/ }));
    expect(back).toHaveBeenCalledTimes(1);
    expect(screen.getByText('body')).toBeTruthy();
  });
});
