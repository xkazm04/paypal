import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Shortcuts } from './Shortcuts';

describe('the shortcuts sheet', () => {
  afterEach(cleanup);
  it('names the trial layouts in plain words, not by build round', () => {
    render(<Shortcuts onClose={() => {}} />);
    expect(screen.getByText('New layouts on trial')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/round [12]/i);
  });
});
