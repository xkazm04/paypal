// The approval window's session: the in-memory capability, the lock, and one way to call a
// privileged command. The token lives ONLY in a ref inside this provider's closure: never React
// state (which devtools and serialisers can see), never storage, never a request body - it
// travels as the X-Wallet-Ipc header via InvokeOptions.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SettingsSnapshot } from '@bindings/SettingsSnapshot';
import type { ArgsOf, CommandName, ResultOf } from '../../lib/contract';
import { WalletError, toWalletError } from '../../lib/contract';
import { useEvent, useQuery } from '../../lib/hooks';
import { backend } from '../../lib/runtime';

export type CallResult<K extends CommandName> = { ok: true; value: ResultOf<K> } | { ok: false; error: WalletError };

export type Session = {
  /** The capability was obtained. The token itself is never exposed. */
  tokenReady: boolean;
  tokenError: WalletError | null;
  retryToken: () => void;
  settings: SettingsSnapshot | undefined;
  settingsError: WalletError | null;
  /** settings.locked (or a LOCKED answer since the last unlock). */
  settingsLocked: boolean;
  lockedByError: boolean;
  /** The privileged command currently in flight, if any (one decision at a time). */
  pending: CommandName | null;
  /**
   * Invoke a command. `privileged` attaches the capability header. A LOCKED answer flips the
   * window into its locked state; every failure comes back typed, never thrown.
   */
  call: <K extends CommandName>(cmd: K, args: ArgsOf<K>, privileged?: boolean) => Promise<CallResult<K>>;
  unlocking: boolean;
  unlockError: WalletError | null;
  unlock: () => Promise<boolean>;
  refreshSettings: () => Promise<void>;
};

const Ctx = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside <SessionProvider>');
  return s;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const token = useRef<string | null>(null);
  const [tokenReady, setTokenReady] = useState(false);
  const [tokenError, setTokenError] = useState<WalletError | null>(null);
  const [lockedByError, setLockedByError] = useState(false);
  const [pending, setPending] = useState<CommandName | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<WalletError | null>(null);

  const settingsQ = useQuery('get_settings', null, { refreshOn: ['settings:changed'] });
  const refetchSettings = settingsQ.refetch;
  useEvent('settings:changed', (s) => {
    if (!s.locked) setLockedByError(false);
  });

  const fetchToken = useCallback(async () => {
    try {
      const t = await backend().invoke('approval_token', null);
      token.current = t;
      setTokenReady(true);
      setTokenError(null);
    } catch (e) {
      token.current = null;
      setTokenReady(false);
      setTokenError(toWalletError(e));
    }
  }, []);

  useEffect(() => {
    void fetchToken();
    return () => {
      token.current = null;
    };
  }, [fetchToken]);

  const call = useCallback(async <K extends CommandName>(cmd: K, args: ArgsOf<K>, privileged = false): Promise<CallResult<K>> => {
    if (privileged && !token.current) {
      return { ok: false, error: new WalletError({ code: 'PERMISSION', message: 'the approval capability is not available in this window' }) };
    }
    setPending(cmd);
    try {
      const value = await backend().invoke(cmd, args, privileged && token.current ? { token: token.current } : undefined);
      return { ok: true, value };
    } catch (e) {
      const error = toWalletError(e);
      if (error.code === 'LOCKED') setLockedByError(true);
      return { ok: false, error };
    } finally {
      setPending(null);
    }
  }, []);

  const unlock = useCallback(async () => {
    setUnlocking(true);
    setUnlockError(null);
    try {
      if (!token.current) throw new WalletError({ code: 'PERMISSION', message: 'the approval capability is not available in this window' });
      await backend().invoke('unlock', {}, { token: token.current });
      setLockedByError(false);
      await refetchSettings();
      return true;
    } catch (e) {
      setUnlockError(toWalletError(e));
      return false;
    } finally {
      setUnlocking(false);
    }
  }, [refetchSettings]);

  const value = useMemo<Session>(
    () => ({
      tokenReady,
      tokenError,
      retryToken: () => void fetchToken(),
      settings: settingsQ.data,
      settingsError: settingsQ.error,
      settingsLocked: settingsQ.data?.locked ?? false,
      lockedByError,
      pending,
      call,
      unlocking,
      unlockError,
      unlock,
      refreshSettings: settingsQ.refetch,
    }),
    [tokenReady, tokenError, fetchToken, settingsQ.data, settingsQ.error, settingsQ.refetch, lockedByError, pending, call, unlocking, unlockError, unlock],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
