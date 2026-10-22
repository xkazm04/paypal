// A window whose backend fails to start says so instead of staying blank (the entries call
// `void mount(...)`, so a rejection used to be an unhandled one on an empty page).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WINDOW_START_FAILED } from './words';

const init = vi.hoisted(() => ({ initBackend: vi.fn() }));
vi.mock('./runtime', () => init);

import { mount } from './mount';

beforeEach(() => { document.body.innerHTML = '<div id="root"></div>'; });
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('mount', () => {
  it('a backend that fails to start leaves one sentence in #root, logs the error and rejects nothing', async () => {
    const err = new Error('mock chunk 404');
    init.initBackend.mockRejectedValueOnce(err);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(mount('main', () => null)).resolves.toBeUndefined();
    expect(document.getElementById('root')?.textContent).toBe(WINDOW_START_FAILED);
    expect(logged).toHaveBeenCalledWith('[window:start]', err);
  });

  it('a backend that starts draws the app', async () => {
    init.initBackend.mockResolvedValueOnce(undefined);
    await mount('tumbler', () => <p>drawn</p>);
    await vi.waitFor(() => expect(document.getElementById('root')?.textContent).toBe('drawn'));
  });
});
