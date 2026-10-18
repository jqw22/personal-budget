import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { loadAccount, restoreSigner, saveAccount, type SavedAccount } from './account';
import { extensionSigner, keySigner, parseSecretKey, type Signer } from './nostr';
import { RelaySync } from './relays';
import { emptyData } from './store';
import { applyRemote, mergeData } from './sync';
import type { BudgetData } from './types';

export interface SyncState {
  status: 'signed-out' | 'loading' | 'saving' | 'saved' | 'error';
  message?: string;
  savedAt?: Date;
}

/** Wait after the last change before saving, so a run of edits goes up as one save. */
const SAVE_DELAY_MS = 1500;

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Signs in with Nostr and keeps `data` saved, encrypted, on the user's relays. */
export function useSync(data: BudgetData, setData: Dispatch<SetStateAction<BudgetData>>) {
  const [account, setAccount] = useState<SavedAccount>(loadAccount);
  const [signer, setSigner] = useState<Signer | null>(null);
  const [state, setState] = useState<SyncState>({ status: 'signed-out' });
  const sync = useRef<RelaySync | null>(null);
  // Saving waits until relay data has been loaded and merged, so it can't overwrite it.
  const loaded = useRef(false);
  const latest = useRef(data);
  latest.current = data;

  function updateAccount(next: SavedAccount) {
    saveAccount(next);
    setAccount(next);
  }

  async function save(current: RelaySync, next: BudgetData) {
    if (!current.hasChanges(next)) return;
    setState({ status: 'saving' });
    try {
      await current.save(next);
      if (sync.current === current) setState({ status: 'saved', savedAt: new Date() });
    } catch (e) {
      if (sync.current === current) setState({ status: 'error', message: errorMessage(e) });
    }
  }

  async function connect(next: Signer, relays: string[]) {
    sync.current?.close();
    loaded.current = false;
    const current = new RelaySync(next, relays, (incoming, base) => {
      if (sync.current === current) setData((local) => applyRemote(local, base, incoming));
    });
    sync.current = current;
    setSigner(next);
    setState({ status: 'loading' });
    try {
      const remote = await current.load();
      if (sync.current !== current) return;
      const merged = remote ? mergeData(latest.current, remote) : latest.current;
      setData(merged);
      loaded.current = true;
      setState({ status: 'saved', savedAt: new Date() });
      await save(current, merged);
    } catch (e) {
      if (sync.current === current) setState({ status: 'error', message: errorMessage(e) });
    }
  }

  useEffect(() => {
    const saved = loadAccount();
    if (!saved.method) return;
    restoreSigner(saved)
      .then((restored) => restored && connect(restored, saved.relays))
      .catch((e) => setState({ status: 'error', message: errorMessage(e) }));
    return () => sync.current?.close();
    // Runs once, on opening the app.
  }, []);

  useEffect(() => {
    const current = sync.current;
    if (!current || !loaded.current) return;
    const timer = setTimeout(() => save(current, data), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [data]);

  return {
    account,
    signer,
    state,
    async signInWithExtension() {
      const next = await extensionSigner();
      updateAccount({ relays: account.relays, method: 'extension' });
      await connect(next, account.relays);
    },
    async signInWithKey(nsec: string, remember: boolean) {
      const next = keySigner(parseSecretKey(nsec));
      updateAccount({ relays: account.relays, method: 'key', nsec: remember ? nsec.trim() : undefined });
      await connect(next, account.relays);
    },
    signOut(clearDevice: boolean) {
      sync.current?.close();
      sync.current = null;
      loaded.current = false;
      setSigner(null);
      setState({ status: 'signed-out' });
      updateAccount({ relays: account.relays });
      if (clearDevice) setData(emptyData());
    },
    setRelays(relays: string[]) {
      updateAccount({ ...account, relays });
      if (signer) void connect(signer, relays);
    },
    syncNow() {
      if (signer) void connect(signer, account.relays);
    },
  };
}
