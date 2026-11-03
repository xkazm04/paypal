// The console's tests render the main window's App. Since spark the-proof-table the board is the
// app's default home, so a console test opens the console the way an owner who chose it would: the
// choice remembered (switchboard/view.ts), and the in-memory view forgotten so this page's address and
// storage decide again.
import { resetHomeView, VIEW_KEY } from '../../switchboard/view';

export function openOnConsole(): void {
  try { localStorage.setItem(VIEW_KEY, 'console'); } catch { /* no storage: the address decides */ }
  resetHomeView();
}
