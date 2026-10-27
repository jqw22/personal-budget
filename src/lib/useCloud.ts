import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { CloudSync } from './cloud';
import { emptyData } from './store';
import { chunkStore, supabase, supabaseConfigured } from './supabase';
import { applyRemote, mergeData } from './sync';
import type { BudgetData } from './types';
import type { SyncState } from './useSync';

/** Wait after the last change before saving, so a run of edits goes up as one save. */
const SAVE_DELAY_MS = 1500;
/** How often an open app looks for saves from the user's other devices. */
const REFRESH_MS = 60_000;

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Signs in to Supabase with an emailed link and keeps `data` saved there. */
export function useCloud(data: BudgetData, setData: Dispatch<SetStateAction<BudgetData>>) {
  const [email, setEmail] = useState<string | null>(null);
  const [state, setState] = useState<SyncState>({ status: 'signed-out' });
  const sync = useRef<CloudSync | null>(null);
  const userId = useRef<string | null>(null);
  // Saving waits until Supabase data has been loaded and merged, so it can't overwrite it.
  const loaded = useRef(false);
  const latest = useRef(data);
  latest.current = data;

  async function save(current: CloudSync, next: BudgetData) {
    if (!current.hasChanges(next)) return;
    setState({ status: 'saving' });
    try {
      await current.save(next);
      if (sync.current === current) setState({ status: 'saved', savedAt: new Date() });
    } catch (e) {
      if (sync.current === current) setState({ status: 'error', message: errorMessage(e) });
    }
  }

  async function connect(id: string) {
    loaded.current = false;
    const current = new CloudSync(chunkStore(await supabase(), id), (incoming, base) => {
      if (sync.current === current) setData((local) => applyRemote(local, base, incoming));
    });
    sync.current = current;
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

  function disconnect() {
    sync.current = null;
    userId.current = null;
    loaded.current = false;
    setEmail(null);
    setState({ status: 'signed-out' });
  }

  useEffect(() => {
    if (!supabaseConfigured) return;
    let unsubscribe = () => {};
    void supabase().then((db) => {
      const { data: listener } = db.auth.onAuthStateChange((_event, session) => {
        const user = session?.user;
        if (!user) {
          if (userId.current) disconnect();
          return;
        }
        setEmail(user.email ?? null);
        // Token refreshes report the same user again; only a new sign-in loads.
        if (userId.current === user.id) return;
        userId.current = user.id;
        // Outside the auth callback, so the client isn't waited on from inside its own lock.
        setTimeout(() => void connect(user.id));
      });
      unsubscribe = () => listener.subscription.unsubscribe();
    });
    return () => unsubscribe();
    // Runs once, on opening the app.
  }, []);

  useEffect(() => {
    const current = sync.current;
    if (!current || !loaded.current) return;
    const timer = setTimeout(() => save(current, data), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [data]);

  useEffect(() => {
    const refresh = () => {
      const current = sync.current;
      if (current && loaded.current && document.visibilityState === 'visible') {
        current.refresh().catch((e) => sync.current === current && setState({ status: 'error', message: errorMessage(e) }));
      }
    };
    const timer = setInterval(refresh, REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  return {
    configured: supabaseConfigured,
    email,
    state,
    /** Emails a link that signs this browser in, creating the account the first time. */
    async sendLink(address: string) {
      const db = await supabase();
      const { error } = await db.auth.signInWithOtp({
        email: address.trim(),
        options: { emailRedirectTo: `${location.origin}${location.pathname}` },
      });
      if (error) throw new Error(error.message);
    },
    async signOut(clearDevice: boolean) {
      const db = await supabase();
      disconnect();
      await db.auth.signOut({ scope: 'local' });
      if (clearDevice) setData(emptyData());
    },
    syncNow() {
      if (userId.current) void connect(userId.current);
    },
  };
}
