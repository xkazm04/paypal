// The licence gate: a missing key, an expired trial or a failed chunk leaves Community, untouched.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModuleRegistry } from 'ag-grid-community';
import { enterpriseAllowed, gridTier, loadEnterprise, resetGridTier, TRIAL_ENDS_AT } from './gridLicence';

const BEFORE = Date.UTC(2026, 10, 9);

function fakeChunk() {
  const setLicenseKey = vi.fn();
  const module = { moduleName: 'RowGrouping' } as never;
  return { setLicenseKey, chunk: { LicenseManager: { setLicenseKey }, RowGroupingModule: module } };
}

afterEach(() => { resetGridTier(); vi.restoreAllMocks(); });

describe('enterpriseAllowed', () => {
  it('needs a key', () => {
    expect(enterpriseAllowed(undefined, BEFORE)).toBe(false);
    expect(enterpriseAllowed('', BEFORE)).toBe(false);
    expect(enterpriseAllowed('   ', BEFORE)).toBe(false);
    expect(enterpriseAllowed('k', BEFORE)).toBe(true);
  });
  it('stops at the end of the trial, to the millisecond', () => {
    expect(enterpriseAllowed('k', TRIAL_ENDS_AT - 1)).toBe(true);
    expect(enterpriseAllowed('k', TRIAL_ENDS_AT)).toBe(false);
    expect(TRIAL_ENDS_AT).toBe(Date.parse('2026-12-09T00:00:00Z'));
  });
});

describe('loadEnterprise', () => {
  it('ON: sets the key, registers the module and reports enterprise', async () => {
    const reg = vi.spyOn(ModuleRegistry, 'registerModules').mockImplementation(() => {});
    const { chunk, setLicenseKey } = fakeChunk();
    await expect(loadEnterprise('k', BEFORE, async () => chunk)).resolves.toBe('enterprise');
    expect(setLicenseKey).toHaveBeenCalledWith('k');
    expect(reg).toHaveBeenCalledTimes(1);
    expect(gridTier()).toBe('enterprise');
  });
  it('OFF, no key: the chunk is never asked for', async () => {
    const importer = vi.fn();
    await expect(loadEnterprise(undefined, BEFORE, importer)).resolves.toBe('community');
    expect(importer).not.toHaveBeenCalled();
  });
  it('OFF, expired: the chunk is never asked for, even with a key', async () => {
    const importer = vi.fn();
    await expect(loadEnterprise('k', TRIAL_ENDS_AT, importer)).resolves.toBe('community');
    expect(importer).not.toHaveBeenCalled();
  });
  it('OFF, a build without the chunk stays Community', async () => {
    await expect(loadEnterprise('k', BEFORE, null)).resolves.toBe('community');
  });
  it('a failed import stays Community and never rejects', async () => {
    const reg = vi.spyOn(ModuleRegistry, 'registerModules').mockImplementation(() => {});
    await expect(loadEnterprise('k', BEFORE, async () => { throw new Error('no chunk'); })).resolves.toBe('community');
    expect(reg).not.toHaveBeenCalled();
    expect(gridTier()).toBe('community');
  });
});
