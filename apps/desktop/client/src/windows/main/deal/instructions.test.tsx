// Agent instructions (agent-tool-surface-1): an agent app run carries the role playbook it was
// given, the owner can read it word for word in the deal's details, and the practice agent says
// it reads none. The text itself is generated from the same Rust constants the engine writes.
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Playbook } from '@bindings/Playbook';
import { PLAYBOOKS } from '@bindings/playbooks';
import { INSTRUCTIONS_NONE, INSTRUCTIONS_TITLE, PLAYBOOK_NAME } from '../../../lib/words';
import { mockBackend } from '../../../mock/backend';
import { InstructionsSheet, InstructionsValue } from './Instructions';

const ALL: Playbook[] = ['buyer_haggler', 'seller_counter', 'shopper', 'shop_assistant'];

describe('agent instructions', () => {
  afterEach(cleanup);

  it('every playbook has a plain name and its full text, with no vendor name or placeholder', () => {
    for (const p of ALL) {
      expect(PLAYBOOK_NAME[p]).toMatch(/^[A-Z]/);
      const text = PLAYBOOKS[p];
      expect(text.length).toBeGreaterThan(400);
      expect(text).not.toMatch(/claude|anthropic|openai|codex|gpt/i);
      expect(text).not.toMatch(/\{\{|\$\{|<|>/);
    }
  });

  it('an agent app run names its playbook; a practice-agent run reads none (mock parity with engines.rs)', async () => {
    const main = mockBackend('main');
    const deals = await main.invoke('list_deals', null);
    const haggle = deals.find((d) => d.kind === 'haggle' && d.side === 'buyer' && ['LISTED', 'NEGOTIATING', 'PAIRING'].includes(d.state));
    expect(haggle).toBeTruthy();
    if (!haggle) return;
    const native = await main.invoke('agent_start', { deal_id: haggle.id });
    expect(native.engine).not.toBe('scripted');
    expect(native.playbook).toBe('buyer_haggler');
    await main.invoke('engine_select', { engine: 'scripted' });
    const practice = await main.invoke('agent_start', { deal_id: haggle.id });
    expect(practice.playbook).toBeNull();
  });

  it('the details row opens the text word for word, or says a practice run has none', () => {
    let opened = 0;
    const r = render(<InstructionsValue run={{ playbook: 'seller_counter' }} onOpen={() => { opened += 1; }} />);
    expect(r.container.textContent).toContain(PLAYBOOK_NAME.seller_counter);
    fireEvent.click(r.getByRole('button', { name: 'Read' }));
    expect(opened).toBe(1);
    cleanup();
    const none = render(<InstructionsValue run={{ playbook: null }} onOpen={() => {}} />);
    expect(none.container.textContent).toBe(INSTRUCTIONS_NONE);
    expect(none.queryByRole('button')).toBeNull();
    cleanup();
    const sheet = render(<InstructionsSheet playbook="buyer_haggler" onClose={() => {}} />);
    expect(sheet.getByRole('dialog', { name: INSTRUCTIONS_TITLE })).toBeTruthy();
    expect(document.querySelector('pre.dv-instr')?.textContent).toBe(PLAYBOOKS.buyer_haggler);
  });
});
