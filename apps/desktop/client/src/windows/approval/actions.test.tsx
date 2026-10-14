import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Actions, HOLD_KEYS } from './DealReview';
import { PAYMENT_CANNOT_BE_UNDONE } from '../../lib/words';
import type { Gate, Gates } from './gating';

const on: Gate = { visible: true, enabled: true, reason: null };
const off: Gate = { visible: false, enabled: false, reason: null };
const gates = (o: Partial<Gates> = {}): Gates => ({
  ownerAccept: off, countersign: off, openPaypal: off, capture: off, void: off, releaseHold: off, rescue: off, withdraw: off, bandSet: off, ...o,
});

function setup(g: Gates, seller = false) {
  const onDecide = vi.fn();
  const onOpen = vi.fn();
  const utils = render(
    <Actions
      phase="ready" gates={g} locked={false} busy={false} pending={null} total="$64.00" who="Dan" seller={seller}
      unlocking={false} canUnlock onUnlock={() => {}} onDecide={onDecide} onOpen={onOpen} onWithdraw={() => {}} onClose={() => {}}
      guardEnter={() => {}} guardEnterHold={() => {}}
    />,
  );
  const holds = () => Array.from(utils.container.querySelectorAll('.ui-hold')).map((b) => b.textContent ?? '');
  return { ...utils, onDecide, onOpen, holds };
}

describe('the approval actions', () => {
  afterEach(() => cleanup());

  it('names exactly the five money decisions as hold buttons', () => {
    expect([...HOLD_KEYS].sort()).toEqual(['cap', 'cs', 'oa', 'rel', 'res']);
  });

  it('every money action in HOLD_KEYS renders as a hold button, none as a click', () => {
    const { holds, container, onDecide } = setup(gates({ ownerAccept: on, countersign: on, capture: on, rescue: on, releaseHold: on, openPaypal: on, void: on }));
    const labels = holds();
    expect(labels).toHaveLength(HOLD_KEYS.size);
    expect(labels.filter((l) => l.includes('Hold to approve $64.00'))).toHaveLength(2); // accept, countersign
    expect(labels.some((l) => l.includes('Hold to pay Dan $64.00'))).toBe(true);
    expect(labels.some((l) => l.includes('Hold to approve the discount'))).toBe(true);
    expect(labels.some((l) => l.includes('Hold to unpause'))).toBe(true);
    // Open PayPal is a hand-off click, Cancel and release hold is the safe direction: neither is a hold.
    const plain = Array.from(container.querySelectorAll('button:not(.ui-hold)')).map((b) => b.textContent ?? '');
    expect(plain.some((t) => t.includes('Open PayPal'))).toBe(true);
    // A click on any hold button decides nothing.
    for (const b of container.querySelectorAll('.ui-hold')) fireEvent.click(b);
    expect(onDecide).not.toHaveBeenCalled();
  });

  it('a seller’s capture is a hold to collect', () => {
    const { holds } = setup(gates({ capture: on }), true);
    expect(holds()).toHaveLength(1);
    expect(holds()[0]).toContain('Hold to collect $64.00');
  });

  it('says the payment cannot be undone only on the buyer’s pay step, not on other approvals or a seller’s collect', () => {
    const pay = setup(gates({ capture: on }));
    expect(pay.container.textContent).toContain(PAYMENT_CANNOT_BE_UNDONE);
    pay.unmount();
    const collect = setup(gates({ capture: on }), true);
    expect(collect.container.textContent).not.toContain(PAYMENT_CANNOT_BE_UNDONE);
    collect.unmount();
    const others = setup(gates({ ownerAccept: on, countersign: on, rescue: on, releaseHold: on, openPaypal: on, void: on }));
    expect(others.container.textContent).not.toContain(PAYMENT_CANNOT_BE_UNDONE);
  });

  it('a gate that is not visible renders no button', () => {
    const { holds } = setup(gates({ capture: on }));
    expect(holds()).toHaveLength(1);
  });
});
