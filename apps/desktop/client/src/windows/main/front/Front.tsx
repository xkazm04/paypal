// spark abstract-first-home: dispatches the prototype front doors (front/variant.ts).
import type { FrontVariant } from './variant';
import { ZoomFront } from './zoom/Zoom';
import { GreetFront } from './greet/Greet';
import { BriefFront } from './brief/Brief';
import { FocusFront } from './focus/Greet';
import { ThreadFront } from './thread/Greet';
import { StageFront } from './stage/Greet';

export function Front({ variant }: { variant: FrontVariant }) {
  if (variant === 'zoom') return <ZoomFront />;
  if (variant === 'greet') return <GreetFront />;
  if (variant === 'focus') return <FocusFront />;
  if (variant === 'thread') return <ThreadFront />;
  if (variant === 'stage') return <StageFront />;
  return <BriefFront />;
}
