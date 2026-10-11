// Wiring test: the wallet's own text never reaches the approval window's token, unlock and pairing-read notices.
// It reads the source (as lib/contrast.test.ts does) and checks only the notices these features own; the other
// WalletNotice sites in this window belong to other features.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(process.cwd(), 'src/windows/approval');

function sources(dir: string): { file: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return e.name.endsWith('.tsx') ? [{ file: e.name, text: readFileSync(path, 'utf8') }] : [];
  });
}

const notices = sources(ROOT).flatMap(({ file, text }) =>
  (text.match(/<WalletNotice\b[\s\S]*?\/>/g) ?? []).map((element) => ({ file, element })),
);
const about = (error: string) => notices.filter((n) => n.element.includes(`error={${error}}`));

describe('the approval window’s notices never show the wallet’s own text', () => {
  it('every token notice carries footerNoticeText(token)', () => {
    const found = about('s.tokenError');
    expect(found.length).toBe(3); // DealReview once, OwnerConfig twice
    expect(found.filter((n) => n.file === 'OwnerConfig.tsx').length).toBe(2);
    for (const n of found) expect(n.element).toContain("message={footerNoticeText('token'");
  });
  it('every unlock notice carries footerNoticeText(unlock)', () => {
    const found = about('s.unlockError');
    expect(found.length).toBeGreaterThanOrEqual(3);
    for (const n of found) expect(n.element).toContain("message={footerNoticeText('unlock'");
  });
  it('the pairing read notice carries a message', () => {
    const found = about('readError');
    expect(found.length).toBe(1);
    expect(found[0]!.file).toBe('PairingConfirm.tsx');
    expect(found[0]!.element).toContain("message={footerNoticeText('pairing_read'");
  });
});
