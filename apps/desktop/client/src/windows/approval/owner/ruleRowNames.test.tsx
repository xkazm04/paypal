// Three signed rule sets for the same agent are three buttons: each needs a name of its own (L2B-01).
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import { nowUnix } from '../../../lib/format';

vi.mock('../session', () => ({ useSession: () => ({ tokenReady: true, pending: null, unlocking: false, settingsLocked: false, lockedByError: false, call: vi.fn() }) }));
vi.mock('../../../lib/runtime', () => ({ backend: () => ({ kind: 'tauri', invoke: vi.fn(), listen: vi.fn() }) }));
const { MandateRow, Credential } = await import('../OwnerConfig');

afterEach(cleanup);
const now = nowUnix();
const entry = (id: string, version: number, ago: number, expires: number) => ({ agent: 'assistant', owner_sig: [], payload: { id, version, agent_key: Array(32).fill(0), clauses: [], not_before: now - ago, expires } }) as unknown as MandateListEntry;

describe('signed rules rows', () => {
  it('give every interactive control a unique accessible name', () => {
    const list = [entry('a', 1, 86400 * 3, now + 86400), entry('b', 1, 86400 * 2, now - 10), entry('c', 2, 86400, now + 86400)];
    const { container } = render(<ul>{list.map((m) => <li key={m.payload.id}><MandateRow m={m} now={now} onOpen={() => {}} /></li>)}</ul>);
    const names = [...container.querySelectorAll('button, a[href], [role="button"]')].map((el) => el.getAttribute('aria-label') ?? el.textContent ?? '');
    expect(names.length).toBeGreaterThanOrEqual(3);
    expect(new Set(names).size).toBe(names.length);
    expect(screen.getAllByRole('button', { name: /^Open Assistant rules/ })).toHaveLength(3);
  });

  it('names rows alike in version, date and state apart by which set they are', () => {
    const list = [entry('a', 1, 86400, now + 86400), entry('b', 1, 86400, now + 86400), entry('c', 1, 86400, now + 86400)];
    const { container } = render(<ul>{list.map((m, i) => <li key={m.payload.id}><MandateRow m={m} now={now} onOpen={() => {}} which={`set ${i + 1} of 3`} /></li>)}</ul>);
    const names = [...container.querySelectorAll('button')].map((el) => el.getAttribute('aria-label') ?? el.textContent ?? '');
    expect(new Set(names).size).toBe(3);
  });

  it('gives each “Replace…” button a name of its own', () => {
    const { container } = render(<><Credential kind="paypal_sandbox" name="PayPal connection" what="your PayPal sandbox app keys" stored locked={false} /><Credential kind="channel3" name="Market prices" what="the key for comparing prices" stored locked={false} /></>);
    const names = [...container.querySelectorAll('button')].filter((b) => /^Replace/.test(b.getAttribute('aria-label') ?? b.textContent ?? '')).map((b) => b.getAttribute('aria-label') ?? '');
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });
});
