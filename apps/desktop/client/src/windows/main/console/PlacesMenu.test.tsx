import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlacesMenu, type PlaceGroup } from './PlacesMenu';

afterEach(cleanup);

function groups(onPick = vi.fn()): PlaceGroup[] {
  const item = (id: string, label: string, lit = false) => ({ id: `cs-place-${id}`, label, title: label, lit, onPick: () => onPick(id) });
  return [
    { key: 'watch', items: [item('rewind', 'Rewind'), item('proof', 'Proof')] },
    { key: 'configure', items: [item('rules', 'Rules', true), item('settings', 'Settings')] },
    { key: 'lab', items: [] },
  ];
}
const button = () => screen.getByRole('button', { name: /Places/ });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
const key = (k: string) => fireEvent.keyDown(document.activeElement as HTMLElement, { key: k });
const at = () => (document.activeElement as HTMLElement).textContent;

describe('PlacesMenu', () => {
  it('is a closed menu button until pressed, then lists the groups and skips empty ones', () => {
    render(<PlacesMenu groups={groups()} />);
    expect(button().getAttribute('aria-haspopup')).toBe('menu');
    expect(button().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(button());
    expect(button().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('menuitem').map((e) => e.textContent)).toEqual(['Rewind', 'Proof', 'Rules', 'Settings']);
    expect(screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Watch', 'Configure']);
  });
  it('marks the open place with aria-current and focuses it on open', async () => {
    render(<PlacesMenu groups={groups()} />);
    fireEvent.click(button());
    await flush();
    expect(screen.getByRole('menuitem', { name: 'Rules' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('menuitem', { name: 'Proof' }).hasAttribute('aria-current')).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Rules' }));
    expect(button().className).toContain('on');
  });
  it('moves with arrows, Home and End, wrapping', async () => {
    render(<PlacesMenu groups={groups()} />);
    fireEvent.click(button());
    await flush();
    key('ArrowDown');
    expect(at()).toBe('Settings');
    key('ArrowDown');
    expect(at()).toBe('Rewind');
    key('ArrowUp');
    expect(at()).toBe('Settings');
    key('Home');
    expect(at()).toBe('Rewind');
    key('End');
    expect(at()).toBe('Settings');
  });
  it('opens from ArrowDown on the button', () => {
    render(<PlacesMenu groups={groups()} />);
    fireEvent.keyDown(button(), { key: 'ArrowDown' });
    expect(screen.getByRole('menu')).toBeTruthy();
  });
  it('closes on Escape and on an outside click', async () => {
    render(<PlacesMenu groups={groups()} />);
    fireEvent.click(button());
    await flush();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(button());
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });
  it('picking an item closes the menu and opens that place', () => {
    const pick = vi.fn();
    render(<PlacesMenu groups={groups(pick)} />);
    fireEvent.click(button());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Proof' }));
    expect(pick).toHaveBeenCalledWith('proof');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
