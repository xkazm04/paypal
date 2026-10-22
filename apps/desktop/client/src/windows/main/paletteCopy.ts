// The words under an empty Find: name what was typed and what is worth trying, in Maya's terms.
import { FIND_NO_MATCH } from '../../lib/words';

export function noMatch(typed: string): string {
  const q = typed.trim();
  return q ? FIND_NO_MATCH.typed(q) : FIND_NO_MATCH.empty;
}
