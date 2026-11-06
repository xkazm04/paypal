// spark abstract-first-home round 3: dispatches the simulated first-project variants (sim/host.ts).
import type { SimProps, SimVariant } from './host';
import { GuideSim } from './guide/Guide';
import { TourSim } from './tour/Tour';
import { StorySim } from './story/Story';

export function Sim({ variant, ...props }: SimProps & { variant: SimVariant }) {
  if (variant === 'guide') return <GuideSim {...props} />;
  if (variant === 'tour') return <TourSim {...props} />;
  return <StorySim {...props} />;
}
