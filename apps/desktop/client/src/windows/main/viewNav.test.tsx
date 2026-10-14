import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ModuleRouteContext, registerViewLabels, useModuleRoute, viewLabel } from './viewNav';

afterEach(() => cleanup());

describe('view labels and the module route', () => {
  it('knows only registered views, and merges later registrations', () => {
    expect(viewLabel('book', 'ledger')).toBeNull();
    registerViewLabels('book', { ledger: 'Ledger' });
    registerViewLabels('book', { outlook: 'Outlook' });
    expect(viewLabel('book', 'ledger')).toBe('Ledger');
    expect(viewLabel('book', 'outlook')).toBe('Outlook');
    expect(viewLabel('book', 'constructor')).toBeNull();
    expect(viewLabel('spend', 'ledger')).toBeNull();
    expect(viewLabel('book', null)).toBeNull();
  });
  it('gives modules a harmless default outside the shell and the real route inside', () => {
    function Probe() { const r = useModuleRoute(); return <button type="button" onClick={() => r.open('ledger', 'c')}>{String(r.view)}</button>; }
    render(<Probe />);
    expect(screen.getByRole('button').textContent).toBe('null');
    cleanup();
    const seen: unknown[] = [];
    render(<ModuleRouteContext.Provider value={{ view: 'ledger', open: (v, c) => seen.push([v, c]) }}><Probe /></ModuleRouteContext.Provider>);
    screen.getByRole('button').click();
    expect(screen.getByRole('button').textContent).toBe('ledger');
    expect(seen).toEqual([['ledger', 'c']]);
  });
});
