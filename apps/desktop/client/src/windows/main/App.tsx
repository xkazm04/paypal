// The Main window of The Table: the Calibre console (console/Console.tsx) under the window's
// providers. Routing follows the `main:route` event and location.hash (#m=, #v=, #d=, #p=<place>,
// #s=setup, #w=waiting, #r=rewind; logic.ts parseHash), so every link the Tumbler and older builds
// wrote still lands where it did (an old sheet link, #s=settings or &p=safety, opens its layer).
import { CounterpartyProvider, ToastProvider } from './ui';
import { Console } from './console/Console';
import { WorldProvider } from './world';

export function App() {
  return (
    <ToastProvider>
      <WorldProvider>
        <CounterpartyProvider>
          <Console />
        </CounterpartyProvider>
      </WorldProvider>
    </ToastProvider>
  );
}
