// "I read this as:" chips and the unsure line: what Maya sees after asking in her own words.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_AI, ReadingChips, UnsureLine } from './AskReading';
import { compose, isUnsure, SUGGESTIONS, understand, type AskCtx, type ReadingChip, type Understood } from './understand';

const NOW = Date.UTC(2026, 9, 7, 13, 30) / 1000;
const CTX: AskCtx = { now: NOW, offsetMin: 120, parties: [{ key: 'kp_cable', name: 'cablehaus', aliases: ['cablehaus'] }] };
const read = (text: string): Understood => {
  const u = understand(text, CTX);
  if (isUnsure(u)) throw new Error(u.unsure.join(', '));
  return u;
};

afterEach(cleanup);

describe('ReadingChips', () => {
  it('shows the reading as chips in plain words, with the honest note', () => {
    const u = read('How much did I pay cablehaus this week, by shop?');
    const { container } = render(<ReadingChips reading={u.reading} ctx={CTX} onChange={() => {}} />);
    expect(screen.getByText('I read this as:')).toBeTruthy();
    const chips = [...container.querySelectorAll('li.rd-chip')];
    expect(chips.map((c) => c.getAttribute('data-chip'))).toEqual(['s:paid', 'p:kp_cable', 't:this_week', 'g:counterparty']);
    expect(chips[0]?.textContent).toContain('Paid');
    expect(chips[1]?.textContent).toContain('cablehaus');
    expect((screen.getByLabelText('When') as HTMLSelectElement).selectedOptions[0]?.textContent).toBe('This week');
    expect((screen.getByLabelText('One line per') as HTMLSelectElement).selectedOptions[0]?.textContent).toBe('By shop or customer');
    expect(screen.getByText(NO_AI)).toBeTruthy();
    // Never the machinery on screen.
    expect(container.textContent).not.toMatch(/book_query|BookQuery|counterparty|CAPTURED|kp_cable|UNAVAILABLE/);
  });

  it('removing a chip hands back the reading without it', () => {
    const u = read('Paid out this week by shop');
    const onChange = vi.fn<(next: ReadingChip[]) => void>();
    render(<ReadingChips reading={u.reading} ctx={CTX} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Paid' }));
    const next = onChange.mock.calls[0]?.[0] ?? [];
    expect(next.map((c) => c.id)).toEqual(['t:this_week', 'g:counterparty']);
    const again = compose(next, CTX);
    expect(!isUnsure(again) && again.query.filters).toEqual([]);
  });

  it('changing the time or the grouping swaps that chip', () => {
    const u = read('Paid out this week by shop');
    const onChange = vi.fn<(next: ReadingChip[]) => void>();
    render(<ReadingChips reading={u.reading} ctx={CTX} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('When'), { target: { value: JSON.stringify({ k: 'yesterday' }) } });
    expect(onChange.mock.calls[0]?.[0].map((c) => c.text)).toEqual(['Paid', 'Yesterday', 'By shop or customer']);
    fireEvent.change(screen.getByLabelText('One line per'), { target: { value: 'day' } });
    expect(onChange.mock.calls[1]?.[0].map((c) => c.text)).toEqual(['Paid', 'This week', 'By day']);
  });

  it('“Any time” can be changed but not removed', () => {
    const u = read('What is on hold?');
    render(<ReadingChips reading={u.reading} ctx={CTX} onChange={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Remove Any time' })).toBeNull();
    expect((screen.getByLabelText('When') as HTMLSelectElement).value).toBe(JSON.stringify({ k: 'any' }));
    expect(screen.getByRole('button', { name: 'Remove On hold' })).toBeTruthy();
  });
});

describe('UnsureLine', () => {
  it('lists the words it did not get and offers phrasings that work', () => {
    const u = understand('Payments over $100 to bob', CTX);
    if (!isUnsure(u)) throw new Error('read');
    const onTry = vi.fn<(t: string) => void>();
    const { container } = render(<UnsureLine unsure={u} onTry={onTry} />);
    expect(container.querySelector('.rd-msg')?.textContent).toBe('I didn’t understand “over”, “$100”, “bob”.');
    const tries = screen.getAllByRole('button');
    expect(tries.map((b) => b.textContent)).toEqual([...SUGGESTIONS]);
    fireEvent.click(tries[1] as HTMLElement);
    expect(onTry).toHaveBeenCalledWith(SUGGESTIONS[1]);
    expect(screen.getByText(NO_AI)).toBeTruthy();
  });

  it('says a too-long question plainly', () => {
    const u = understand('x'.repeat(201), CTX);
    if (!isUnsure(u)) throw new Error('read');
    const { container } = render(<UnsureLine unsure={u} onTry={() => {}} />);
    expect(container.querySelector('.rd-msg')?.textContent).toBe('That is longer than 200 characters. Try a shorter question.');
  });
});
