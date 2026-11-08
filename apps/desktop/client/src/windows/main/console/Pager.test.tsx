// The pager: range footer, numbered pages with gaps, prev / next / first / last, hidden when one page.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pageCount, Pager, pageNumbers } from './Pager';

afterEach(cleanup);

describe('pure parts', () => {
  it('counts pages and picks the numbers to draw', () => {
    expect(pageCount(0, 20)).toBe(1);
    expect(pageCount(94, 20)).toBe(5);
    expect(pageCount(94, 0)).toBe(1);
    expect(pageNumbers(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageNumbers(1, 16)).toEqual([1, 2, null, 16]);
    expect(pageNumbers(3, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageNumbers(8, 16)).toEqual([1, null, 7, 8, 9, null, 16]);
  });
});

describe('Pager', () => {
  it('renders nothing when the rows fit on one page', () => {
    const { container } = render(<Pager page={1} pageSize={20} total={20} onPage={() => {}} label="Deals pages" />);
    expect(container.firstChild).toBeNull();
  });
  it('shows the range and moves with the buttons', () => {
    const onPage = vi.fn();
    render(<Pager page={2} pageSize={20} total={312} onPage={onPage} label="Deals pages" />);
    expect(screen.getByRole('navigation', { name: 'Deals pages' })).toBeTruthy();
    expect(screen.getByText('21-40 of 312')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Page 2 of 16' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    fireEvent.click(screen.getByRole('button', { name: 'First page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Last page' }));
    expect(onPage.mock.calls.map((c) => c[0])).toEqual([3, 1, 1, 16]);
  });
  it('disables first / previous on page 1 and the last page shows its short range', () => {
    const { rerender } = render(<Pager page={1} pageSize={20} total={94} onPage={() => {}} label="x" />);
    expect(screen.getByRole('button', { name: 'Previous page' }).hasAttribute('disabled')).toBe(true);
    rerender(<Pager page={5} pageSize={20} total={94} onPage={() => {}} label="x" />);
    expect(screen.getByText('81-94 of 94')).toBeTruthy();
  });
});
