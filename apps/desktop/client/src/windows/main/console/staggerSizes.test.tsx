// A revealed part's height is remembered per window size, so the next skeleton holds exactly its room
// on the same window. The part keeps being measured while it shows; a measure taken after the window
// was resized belongs to the new size and never overwrites the size the part mounted at.
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetSizes, Reveal, Skeleton, Stagger, staggerOff, staggerOn } from './stagger';
import { manualClock } from './testing/manualClock';

const observers: Array<() => void> = [];
let partHeight = 0;

function windowSize(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
}

beforeEach(() => {
  forgetSizes();
  observers.length = 0;
  vi.stubGlobal('ResizeObserver', class {
    constructor(cb: () => void) { observers.push(() => cb()); }
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ top: 0, bottom: partHeight, left: 0, right: 0, width: 0, height: partHeight, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect);
});
afterEach(() => { cleanup(); staggerOff(); vi.restoreAllMocks(); vi.unstubAllGlobals(); windowSize(1024, 768); });

const Layer = ({ clock }: { clock: ReturnType<typeof manualClock>['clock'] }) => (
  <Stagger clock={clock}>
    <Reveal wave={2} sizeKey="part" skeleton={<Skeleton className="sk" />}><p>part</p></Reveal>
  </Stagger>
);

describe('remembered sizes', () => {
  it('a resize while the part shows does not overwrite the height remembered for the size it opened at', () => {
    staggerOff();
    windowSize(1280, 800);
    partHeight = 100;
    const first = render(<Layer clock={manualClock().clock} />);
    observers.forEach((o) => o()); // measured at 1280 x 800: 100 px
    windowSize(800, 800);
    partHeight = 300;
    observers.forEach((o) => o()); // the same part, measured after the window narrowed: 300 px
    first.unmount();

    // Back on the 1280 x 800 window, the part waits for its wave: its skeleton holds 100 px.
    staggerOn();
    windowSize(1280, 800);
    render(<Layer clock={manualClock().clock} />);
    const room = document.querySelector<HTMLElement>('.stg-room');
    expect(room?.style.height).toBe('100px');
  });
});
