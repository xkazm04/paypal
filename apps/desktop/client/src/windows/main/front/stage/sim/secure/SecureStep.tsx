// spark abstract-first-home round 4: the secure step component (contract.ts). STUB with the final
// signature; the secure builder replaces the body (bare approval surface + three presenters).
import type { SecureStepProps } from './contract';

export function SecureStep(props: SecureStepProps) {
  return <div data-secure={props.kind} data-done={props.done ? 'true' : 'false'} />;
}
