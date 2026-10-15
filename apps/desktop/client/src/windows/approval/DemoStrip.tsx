// The sample approval's strip (demo mode, polish wave builder B). In demo mode the main window opens
// this page in its own webview instead of the approval window (lib/runtime.ts); a strip across the
// top says plainly that it is simulated and nothing is paid, whatever the page below shows (loading,
// a review, the owner's setup). "Back to The Table" and Esc return to the console where it was.
// The real approval window never shows it: it is never the demo-marked page.
import type { ComponentType } from 'react';
import { DEMO_APPROVAL } from '../../lib/words';
import { demoApprovalPage } from '../../lib/preview';
import './demo-strip.css';

export function DemoStrip() {
  if (!demoApprovalPage()) return null;
  return <p className="aw-demo-strip" role="note" title={DEMO_APPROVAL.title}>{DEMO_APPROVAL.strip}</p>;
}

/** The approval app with the strip above it (the strip renders nothing outside demo mode). */
export function withDemoStrip(App: ComponentType): ComponentType {
  return function DemoAware() {
    return <><DemoStrip /><App /></>;
  };
}
