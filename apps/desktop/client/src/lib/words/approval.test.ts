// The approval window's first-run heading follows The Table's charter (polish A): it names the
// charter by its own title and counts no steps (the charter has five lines, the page four steps
// and its lock card, so "in 4 steps" never matched).
import { describe, expect, it } from 'vitest';
import { CHARTER_TITLE, FIRST_RUN_TITLE } from '../words';
import { SETUP_STEPS } from '../../windows/main/logic';
import { APPROVAL_FIRST_RUN } from './approval';

describe('the approval window names the charter', () => {
  it('starts with the charter’s own title and carries no count', () => {
    expect(APPROVAL_FIRST_RUN.title.startsWith(`${CHARTER_TITLE}:`)).toBe(true);
    expect(APPROVAL_FIRST_RUN.title).not.toMatch(/\d|four|five/i);
    expect(APPROVAL_FIRST_RUN.welcome.toLowerCase()).toContain(CHARTER_TITLE.toLowerCase());
    expect(APPROVAL_FIRST_RUN.title).not.toBe(FIRST_RUN_TITLE);
  });
  it('the charter it names has five lines', () => {
    expect(SETUP_STEPS.length).toBe(5);
  });
});
