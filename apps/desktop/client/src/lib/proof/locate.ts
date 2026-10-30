// Where a value sits in the editor's text (lib/proof/fileText.ts): the character range of the value at
// a JSON pointer, so the cursor can go to the very number a tamper changed.

/** The range of the value at `pointer` in `text`; for a string, the inside of its quotes. Null when the
 *  text has nothing there. */
export function locate(text: string, pointer: string): [number, number] | null {
  const parts = pointer.split('/').slice(1).map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let i = 0;
  const blank = (): void => {
    while (i < text.length && /\s/.test(text.charAt(i))) i++;
  };
  const string = (): string => {
    const start = i;
    i++;
    while (i < text.length && text.charAt(i) !== '"') i += text.charAt(i) === '\\' ? 2 : 1;
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const skip = (): void => {
    blank();
    const c = text.charAt(i);
    if (c === '"') {
      string();
      return;
    }
    if (c === '{' || c === '[') {
      let depth = 0;
      do {
        const d = text.charAt(i);
        if (d === '"') {
          string();
          continue;
        }
        if (d === '{' || d === '[') depth++;
        if (d === '}' || d === ']') depth--;
        i++;
      } while (depth > 0 && i < text.length);
      return;
    }
    while (i < text.length && !/[,}\]\s]/.test(text.charAt(i))) i++;
  };
  const find = (depth: number): [number, number] | null => {
    blank();
    if (depth === parts.length) {
      const start = i;
      skip();
      return text.charAt(start) === '"' ? [start + 1, i - 1] : [start, i];
    }
    const c = text.charAt(i);
    if (c !== '{' && c !== '[') return null;
    i++;
    blank();
    let index = 0;
    while (i < text.length && text.charAt(i) !== '}' && text.charAt(i) !== ']') {
      let key = String(index);
      if (c === '{') {
        key = string();
        blank();
        i++; // the colon
      }
      if (key === parts[depth]) return find(depth + 1);
      skip();
      index++;
      blank();
      if (text.charAt(i) === ',') i++;
      blank();
    }
    return null;
  };
  try {
    return find(0);
  } catch {
    return null;
  }
}
