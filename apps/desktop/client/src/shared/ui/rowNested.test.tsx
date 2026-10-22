// Row with onOpen is actionable, and its docs invite chips and buttons beside the title. An ARIA
// button has presentational children, so a control inside a role="button" row can vanish for a screen
// reader (axe: nested-interactive). The open action is a real button around the title cell; the row
// itself is a plain container, so a Btn or an actionable Chip beside it stays reachable on its own.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Btn, Chip, Row } from './components';

afterEach(() => cleanup());

const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
/** axe's nested-interactive, as a DOM check: no control that presents its children as text holds another control. */
function nestedInteractive(root: HTMLElement): string[] {
  const out: string[] = [];
  for (const el of root.querySelectorAll<HTMLElement>('[role="button"], [role="link"], button, a[href]')) {
    const inner = el.querySelector(FOCUSABLE);
    if (inner) out.push(`${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''} holds ${inner.tagName.toLowerCase()}`);
  }
  return out;
}

describe('Row with onOpen', () => {
  const open = vi.fn();
  const chip = vi.fn();
  const stop = vi.fn();
  const rich = () => render(
    <Row title="Buyer rules" sub="Up to $40 a deal" label="Open Buyer rules" onOpen={open}>
      <Chip tone="line" onClick={chip}>in force</Chip>
      <Btn sm onClick={stop}>Stop</Btn>
    </Row>,
  );

  it('holds no control inside another control', () => {
    const v = rich();
    expect(nestedInteractive(v.container)).toEqual([]);
  });

  it('opens from its own button (click, and the native Enter/Space of a button), by the row label', () => {
    rich();
    const b = screen.getByRole('button', { name: 'Open Buyer rules' });
    expect(b.tagName).toBe('BUTTON');
    fireEvent.click(b);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('a click on the plain part of the row opens it too; a click on a chip or button inside does not', () => {
    open.mockClear();
    const v = rich();
    fireEvent.click(v.container.querySelector('.ui-row') as HTMLElement);
    expect(open).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'in force' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(chip).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('every control inside is its own named button', () => {
    rich();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Buyer rulesUp to $40 a deal', 'in force', 'Stop']);
  });

  it('a row without onOpen stays a plain container', () => {
    const v = render(<Row title="Unlock" sub="Locks again"><Chip tone="line">none</Chip></Row>);
    expect(v.container.querySelector('button, [role="button"]')).toBeNull();
  });

  it('the pairing row still exposes its title as the open action when selected', () => {
    render(<Row title="Check four words" selected onOpen={open}><Chip tone="gold">needs you</Chip></Row>);
    expect(screen.getByRole('button', { name: /Check four words/ }).getAttribute('aria-current')).toBe('true');
  });
});
