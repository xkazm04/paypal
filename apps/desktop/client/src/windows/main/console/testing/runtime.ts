// The scale smoke harness's backend switch (test-only; never imported by the app). A test file that
// renders layers with `renderLayerAtScale` mocks lib/runtime with this module:
//
//   vi.mock('../../../../lib/runtime', async () => (await import('./testing/runtime')).runtimeMock);
//
// (adjust the relative path to lib/runtime from the test file). It has no import of the app, so the
// mock factory never loops back into the module it is mocking.
import type { Backend } from '../../../../lib/contract';

let current: Backend | null = null;

export function setHarnessBackend(b: Backend | null): void {
  current = b;
}

export const runtimeMock = {
  backend: (): Backend => {
    if (!current) throw new Error('harness backend not set: call renderLayerAtScale first');
    return current;
  },
  initBackend: async (): Promise<Backend> => runtimeMock.backend(),
};
