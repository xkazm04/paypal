import { describe, expect, it } from 'vitest';
import { noMatch } from './paletteCopy';

describe('the empty Find', () => {
  it('echoes what was typed and suggests what to try', () => {
    expect(noMatch('  zzz ')).toBe('Nothing matches “zzz”. Try a shop name, an item or a page like Book.');
  });
  it('never claims a match when nothing was typed', () => {
    expect(noMatch('')).toBe('Nothing to show yet.');
  });
});
