// The Main window of The Table: the Calibre console (console/Console.tsx) under the window's
// providers. Routing follows the `main:route` event and location.hash (#m=, #v=, #d=, #p=<place>,
// #s=setup, #w=waiting, #r=rewind; logic.ts parseHash), so every link the Tumbler and older builds
// wrote still lands where it did (an old sheet link, #s=settings or &p=safety, opens its layer).
// The window has a second view, the board (switchboard/): `?view=board` or the remembered choice
// opens it; the console stays the default. Both views sit under the same providers, so a switch
// remounts neither the World nor the data layer.
import { CounterpartyProvider, ToastProvider } from './ui';
import { Console } from './console/Console';
import { Switchboard } from './switchboard/Switchboard';
import { useHomeView } from './switchboard/view';
import { WorldProvider } from './world';

export function App() {
  const view = useHomeView();
  return (
    <ToastProvider>
      <WorldProvider>
        <CounterpartyProvider>
          {view === 'board' ? <Switchboard /> : <Console />}
        </CounterpartyProvider>
      </WorldProvider>
    </ToastProvider>
  );
}
