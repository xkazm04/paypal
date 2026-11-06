// spark abstract-first-home: dispatches the prototype front doors (front/variant.ts).
import type { FrontVariant } from './variant';
import { ZoomFront } from './zoom/Zoom';
import { GreetFront } from './greet/Greet';
import { BriefFront } from './brief/Brief';

export function Front({ variant }: { variant: FrontVariant }) {
  if (variant === 'zoom') return <ZoomFront />;
  if (variant === 'greet') return <GreetFront />;
  return <BriefFront />;
}
