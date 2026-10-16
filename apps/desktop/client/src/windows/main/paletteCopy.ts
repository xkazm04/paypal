// The words under an empty Find: name what was typed and what is worth trying, in Maya's terms.
export function noMatch(typed: string): string {
  const q = typed.trim();
  return q ? `Nothing matches “${q}”. Try a shop name, an item or a page like Book.` : 'Nothing to show yet.';
}
