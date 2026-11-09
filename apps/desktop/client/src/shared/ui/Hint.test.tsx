import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ExplainHint } from './Hint';
import { closeTopLayer, resetLayersForTest } from './layers';

afterEach(() => { cleanup(); resetLayersForTest(); });

describe('ExplainHint', () => {
  it('shows the line and keeps the explanation closed', () => {
    render(<ExplainHint label="Your key" line="Short">Long body</ExplainHint>);
    expect(screen.getByText('Short')).toBeTruthy();
    expect(screen.queryByText('Long body')).toBeNull();
  });
  it('opens from a uniquely named button', () => {
    render(<ExplainHint label="Your key" line="Short">Long body</ExplainHint>);
    fireEvent.click(screen.getByRole('button', { name: 'More about, Your key' }));
    expect(screen.getByRole('dialog', { name: 'Your key' }).textContent).toContain('Long body');
  });
  it('Esc closes it', () => {
    render(<ExplainHint label="Your key" line="Short">Long body</ExplainHint>);
    fireEvent.click(screen.getByRole('button', { name: 'More about, Your key' }));
    act(() => { closeTopLayer(); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
