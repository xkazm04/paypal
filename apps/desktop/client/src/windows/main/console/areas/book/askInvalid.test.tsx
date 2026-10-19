// Acceptance C1 (STATUS.md): the wallet refuses a query it will not run, and the owner reads that refusal.
// The mock backend runs the same checks as Rust's BookQuery::rejection and fails with INVALID
// 'BookQuery rejected: ...'; here the query the Ask surface sends gains a field the closed query does not
// have (a smuggled `sql`), so the refusal comes from the mock itself, not from a stub.
import { act, cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOOK } from '../../../../../lib/words';
import { renderLayerAtScale, settle } from '../../testing/scaleSmoke';
import { runtimeMock, setHarnessBackend } from '../../testing/runtime';

vi.mock('../../../../../lib/runtime', async () => (await import('../../testing/runtime')).runtimeMock);

afterEach(() => { cleanup(); history.replaceState(null, '', '/'); });

describe('Ask your book refusal (C1)', () => {
  it('shows a rejected BookQuery as text and renders no results', async () => {
    const r = await renderLayerAtScale('#m=book&v=ask', 'large');
    const inner = runtimeMock.backend();
    setHarnessBackend({
      ...inner,
      invoke: (cmd, args, opts) => (cmd === 'book_query'
        ? inner.invoke(cmd, { query: { ...(args as { query: object }).query, sql: 'DELETE FROM audit_log' } } as never, opts)
        : inner.invoke(cmd, args, opts)),
    });
    const box = within(r.layer).getByRole('textbox', { name: BOOK.ask.label });
    fireEvent.change(box, { target: { value: 'How much was paid this week, by shop?' } });
    await act(async () => { fireEvent.submit(box.closest('form') as HTMLFormElement); });
    await settle();
    expect(r.calls.some((c) => c.cmd === 'book_query')).toBe(true);

    const alert = r.layer.querySelector('.bk-slip [role="alert"]');
    expect(alert, 'the refusal is drawn').not.toBeNull();
    expect(alert?.textContent).toContain('Not valid');
    expect(alert?.textContent).toContain('BookQuery rejected: unknown field `sql`');
    // No answer from the wallet: neither its line, its table nor its empty-state text.
    expect(r.layer.querySelector('.bk-wallet')).toBeNull();
    expect(r.layer.textContent).not.toContain(BOOK.ask.noRows);
  }, 60_000);
});
