import { extensionSigner, keySigner, parseSecretKey, type Signer } from './nostr';
import { DEFAULT_RELAYS } from './relays';

const KEY = 'personal-budget:account';

export interface SavedAccount {
  relays: string[];
  /** How the user last signed in; absent when signed out. */
  method?: 'extension' | 'key';
  /** Only kept when the user chose to stay signed in with a private key. */
  nsec?: string;
}

export function loadAccount(): SavedAccount {
  try {
    const raw = localStorage.getItem(KEY);
    return { relays: DEFAULT_RELAYS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { relays: DEFAULT_RELAYS };
  }
}

export function saveAccount(account: SavedAccount): void {
  localStorage.setItem(KEY, JSON.stringify(account));
}

/** Signs back in from a saved account, or returns null if that needs the user's key again. */
export async function restoreSigner(account: SavedAccount): Promise<Signer | null> {
  if (account.method === 'extension') {
    // Some extensions add window.nostr a moment after the page loads.
    for (let i = 0; i < 10 && !window.nostr; i++) await new Promise((r) => setTimeout(r, 200));
    return extensionSigner();
  }
  return account.method === 'key' && account.nsec ? keySigner(parseSecretKey(account.nsec)) : null;
}
