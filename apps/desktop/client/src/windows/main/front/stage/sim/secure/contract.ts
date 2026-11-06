// spark abstract-first-home round 4: the secure step as ONE component the AI-led setup places in a
// conversation turn. A secure step (save PayPal keys, sign rules, confirm the practice shop's words)
// runs only in the approval context; the presenter decides how that context is shown. The approval
// side renders a BARE surface for it (`approval.html?bare=<kind>`): just the one form, no approval
// chrome. Prototype switch `?secure=inline|sheet|popup` picks the presenter; default inline.
export type SecureKind = 'keys' | 'rules' | 'pairing';
export type SecurePresenter = 'inline' | 'sheet' | 'popup';
export const SECURE_PRESENTERS: readonly SecurePresenter[] = ['inline', 'sheet', 'popup'];

export function securePresenter(search: string = typeof location === 'undefined' ? '' : location.search): SecurePresenter {
  const v = new URLSearchParams(search).get('secure');
  return (SECURE_PRESENTERS as readonly string[]).includes(v ?? '') ? (v as SecurePresenter) : 'inline';
}

export type SecureStepProps = {
  kind: SecureKind;
  /** rules: the draft sentence/template to prefill (approval's mandate draft format); else null. */
  draft: string | null;
  /** pairing: the pairing id whose four words to confirm; else null. */
  pairing: string | null;
  /** True once the wallet reports the step done (the caller reads useStart / the world). The
   *  presenter then closes itself with a short success state; it never decides "done" on its own. */
  done: boolean;
  /** She dismissed it without finishing. */
  onCancel: () => void;
};
