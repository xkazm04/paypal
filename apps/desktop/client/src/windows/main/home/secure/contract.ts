// The secure step as ONE component the setup guide places in a conversation turn
// (docs/design/abstract-first-home.md). A secure step (save PayPal keys, sign rules, confirm the
// practice shop's words) runs only in the approval context. In a browser on the mock world it shows as
// a focused sheet over the dimmed app holding the approval side's BARE surface
// (`approval.html?bare=<kind>`: just the one form, no approval chrome); in the desktop app it is the
// approval window itself.
export type SecureKind = 'keys' | 'rules' | 'pairing';

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
