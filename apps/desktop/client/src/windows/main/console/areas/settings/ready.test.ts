// Settings' one answer ("Your wallet is ready") and its "Your call" count the rule sets the way Agent
// rules does: a set the wallet no longer accepts (mandate_list's `refusal`) or one with no owner
// signature allows nothing, so rules like that leave the rules step missing (Sign rules).
import { beforeEach, describe, expect, it } from 'vitest';
import type { MandateListEntry } from '@bindings/MandateListEntry';
import { mockBackend, resetMockState } from '../../../../../mock/backend';
import { deriveCircuit, settingsAnswer } from '../../../setup/circuit';
import { circuitMandates } from './SettingsLayer';

beforeEach(() => {
  history.replaceState(null, '', '/index.html');
  resetMockState();
});

async function circuitWith(edit: (m: MandateListEntry) => MandateListEntry) {
  const b = mockBackend('main');
  const s = await b.invoke('get_settings', null);
  // The preview wallet's agent app is chosen and working, so only the rules can break here.
  const engines = (await b.invoke('engine_status', null)).map((e) => ({ ...e, available: true }));
  const list = (await b.invoke('mandate_list', null)).map(edit);
  const now = Math.floor(Date.now() / 1000);
  const c = deriveCircuit({ settings: s, engines, mandates: circuitMandates(list), running: 0, locked: false, now });
  return { breaks: c.breaks.map((x) => x.key), tone: settingsAnswer(c, { firstRun: false, settingsKnown: true, locked: false }).tone };
}

describe('Settings · is the wallet ready', () => {
  it('is ready with the preview wallet’s signed rule sets', async () => {
    expect(await circuitWith((m) => m)).toEqual({ breaks: [], tone: 'done' });
  });
  it('is not ready when every rule set is one the wallet now refuses', async () => {
    expect(await circuitWith((m) => ({ ...m, refusal: { clause: 3, reason: 'no longer fits' } }))).toEqual({ breaks: ['mandate'], tone: 'need' });
  });
  it('is not ready when no rule set carries the owner’s signature', async () => {
    expect(await circuitWith((m) => ({ ...m, owner_sig: [] }))).toEqual({ breaks: ['mandate'], tone: 'need' });
  });
});
