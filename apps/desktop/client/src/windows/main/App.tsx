// The Main window of The Table: the board or the Calibre console (console/Console.tsx) under the
// window's providers. Routing follows the `main:route` event and location.hash (#m=, #v=, #d=, #p=<place>,
// #s=setup, #w=waiting, #r=rewind; logic.ts parseHash), so every link the Tumbler and older builds
// wrote still lands where it did (an old sheet link, #s=settings or &p=safety, opens its layer).
// The window has two views: the board (switchboard/), the default home since spark the-proof-table,
// and the console. `?view=`, a console deep link in the hash, then the remembered choice decide
// (switchboard/view.ts). Both views sit under the same providers, so a switch remounts neither the
// World nor the data layer.
import { CounterpartyProvider, ToastProvider } from './ui';
import { Console } from './console/Console';
import { Switchboard } from './switchboard/Switchboard';
import { useHomeView } from './switchboard/view';
import { WorldProvider } from './world';
import { Front } from './front/Front';
import { frontVariant } from './front/variant';

export function App() {
  const view = useHomeView();
  const front = frontVariant();
  return (
    <ToastProvider>
      <WorldProvider>
        <CounterpartyProvider>
          {front && view === 'board' ? <Front variant={front} /> : view === 'board' ? <Switchboard /> : <Console />}
        </CounterpartyProvider>
      </WorldProvider>
    </ToastProvider>
  );
}
