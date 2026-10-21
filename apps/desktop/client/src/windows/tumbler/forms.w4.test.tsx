// Acceptance W4 (STATUS.md): counterparty free text never reaches the Tumbler. This renders the card
// form (and its Details popover) for the attention items of mock deals whose counterparty signed a
// NOTE, and asserts that none of that text is anywhere in the DOM, and that the Tumbler never even
// asked for it. The counterparty's display name (composed by Rust) is the one thing of theirs the
// card shows, and is asserted present so the test cannot pass on an empty render.
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Backend } from '../../lib/contract';
import { mockBackend, resetMockState } from '../../mock/backend';
import { setHarnessBackend } from '../main/console/testing/runtime';
import { CardForm, HandoffForm, StackForm, TickerForm } from './forms';
import { ackTicker, arrivalsTicker, arrivalTicker, plainItems, receiptTicker, snoozeTicker } from './logic';

vi.mock('../../lib/runtime', async () => (await import('../main/console/testing/runtime')).runtimeMock);

afterEach(() => { cleanup(); setHarnessBackend(null); });

describe('Tumbler card form (W4)', () => {
  it('draws no counterparty free text, in the card or its Details', async () => {
    resetMockState();
    const main = mockBackend('main');
    const tumbler = mockBackend('tumbler');
    const calls: string[] = [];
    const wrapped: Backend = { ...tumbler, invoke: (cmd, args, opts) => { calls.push(cmd); return tumbler.invoke(cmd, args, opts); } };
    setHarnessBackend(wrapped);

    const att = await main.invoke('attention_list', null);
    // Every note the counterparties signed on a deal that has an attention item.
    const spoken: { item: AttentionItem; text: string }[] = [];
    for (const item of att.items) {
      const note = await main.invoke('counterparty_note', { deal_id: item.deal_id });
      if (note) spoken.push({ item, text: note.text });
    }
    expect(spoken.length, 'the mock world has attention items whose counterparty wrote a note').toBeGreaterThan(0);

    for (const { item, text } of spoken) {
      const { container, unmount } = render(
        <CardForm item={item} items={att.items} now={Math.floor(Date.now() / 1000)} locked={false} confirming={false} reviewed={false}
          busy={false} pending={null} failure={null} onAction={() => {}} onConfirm={() => {}} onNav={() => {}} onStack={() => {}} onKey={() => {}} />,
      );
      await act(async () => { fireEvent.click(container.querySelector('button[aria-label^="Details:"]') as HTMLElement); });
      await waitFor(() => expect(document.body.textContent).toContain('Why?'));
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
      const dom = document.body.textContent ?? '';
      // The Rust-composed display name is there; their words are not, whole or in any 20-character piece.
      expect(dom).toContain(item.counterparty ? item.counterparty.split(' · ')[0]! : 'a connected wallet');
      for (let i = 0; i + 20 <= text.length; i += 10) expect(dom, `note piece "${text.slice(i, i + 20)}"`).not.toContain(text.slice(i, i + 20));
      expect(document.body.innerHTML).not.toContain(text.slice(0, 20));
      unmount();
    }
    // The wallet would refuse the Tumbler the note anyway; it must not even ask.
    expect(calls).not.toContain('counterparty_note');
    expect(calls).not.toContain('counterparty_list');
  }, 60_000);

  // W4 says "any Tumbler form": the stack, every ticker and the hand-off draw the same items.
  it('draws no counterparty free text in the stack, the tickers or the hand-off', async () => {
    resetMockState();
    const main = mockBackend('main');
    const tumbler = mockBackend('tumbler');
    const calls: string[] = [];
    setHarnessBackend({ ...tumbler, invoke: (cmd, args, opts) => { calls.push(cmd); return tumbler.invoke(cmd, args, opts); } });

    const att = await main.invoke('attention_list', null);
    const items = plainItems(att.items);
    const notes: string[] = [];
    for (const item of att.items) {
      const note = await main.invoke('counterparty_note', { deal_id: item.deal_id });
      if (note) notes.push(note.text);
    }
    expect(notes.length, 'the mock world has attention items whose counterparty wrote a note').toBeGreaterThan(0);
    const clean = (where: string) => {
      const dom = document.body.innerHTML;
      for (const text of notes) {
        for (let i = 0; i + 20 <= text.length; i += 10) expect(dom, `${where}: note piece "${text.slice(i, i + 20)}"`).not.toContain(text.slice(i, i + 20));
      }
    };
    const now = Math.floor(Date.now() / 1000);

    const stack = render(<StackForm snapshot={{ ...att, items }} items={items} now={now} locked={false} mode="sandbox" metersAvailable paused={false} pinned dnd={false}
      failure={null} onOpen={() => {}} onTable={() => {}} onPin={() => {}} onDnd={() => {}} />);
    expect(stack.container.querySelectorAll('.s-row')).toHaveLength(items.length);
    clean('stack');
    stack.unmount();

    const tickers = [arrivalsTicker(items), ...items.flatMap((i) => [
      arrivalTicker(i), snoozeTicker(i, now + 1800), ackTicker(i, 'withdraw'), ackTicker(i, 'let_lapse'),
      receiptTicker({ deal_id: i.deal_id, evidence: { deal_id: i.deal_id, receipt: 'NONE', reconciliation: 'not_applicable' }, mode: i.mode, state: 'CAPTURED', on_silence: 'no money moved' }, i),
    ])];
    for (const t of tickers) {
      const r = render(<TickerForm ticker={t} onOpen={() => {}} />);
      clean(`ticker ${t?.key}`);
      r.unmount();
    }

    for (const item of items) {
      const r = render(<HandoffForm handoff={{ active: true, dealId: item.deal_id, approveUntil: now + 3600 }} item={item} display={null} now={now} locked={false} mode="sandbox" onTable={() => {}} onRest={() => {}} />);
      clean(`hand-off ${item.label}`);
      r.unmount();
    }
    expect(calls).not.toContain('counterparty_note');
    expect(calls).not.toContain('counterparty_list');
  }, 60_000);
});
