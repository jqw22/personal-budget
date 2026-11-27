import { finalizeEvent, generateSecretKey, getPublicKey, nip19, nip44, type Event, type EventTemplate } from 'nostr-tools';

/** Signs and encrypts as the signed-in Nostr user. Data is encrypted to the user's own key. */
export interface Signer {
  method: 'extension' | 'key';
  /** Hex public key. */
  pubkey: string;
  encrypt(plaintext: string): Promise<string>;
  decrypt(payload: string): Promise<string>;
  sign(template: EventTemplate): Promise<Event>;
  /** Throws a KeyMismatch if the key doing the work is no longer `pubkey`, such as an extension switched to another account. */
  verify(): Promise<void>;
}

/** The extension is signing as a different npub from the one the app is signed in as. */
export class KeyMismatch extends Error {
  constructor(
    public expected: string,
    public actual: string,
  ) {
    super(
      `Your Nostr extension is set to ${shortNpub(actual)}, but you're signed in here as ${shortNpub(expected)}. ` +
        'Nothing was saved to your relays. Switch your extension back, then press Sync now.',
    );
    this.name = 'KeyMismatch';
  }
}

export function shortNpub(pubkey: string): string {
  const full = npub(pubkey);
  return `${full.slice(0, 12)}…${full.slice(-6)}`;
}

interface WindowNostr {
  getPublicKey(): Promise<string>;
  signEvent(event: EventTemplate): Promise<Event>;
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
}

declare global {
  interface Window {
    nostr?: WindowNostr;
  }
}

export function keySigner(secret: Uint8Array): Signer {
  const pubkey = getPublicKey(secret);
  const conversationKey = nip44.getConversationKey(secret, pubkey);
  return {
    method: 'key',
    pubkey,
    encrypt: async (plaintext) => nip44.encrypt(plaintext, conversationKey),
    decrypt: async (payload) => nip44.decrypt(payload, conversationKey),
    sign: async (template) => finalizeEvent(template, secret),
    verify: async () => {},
  };
}

/**
 * Uses a NIP-07 browser extension such as Alby or nos2x, which keeps the key to itself.
 * `expected` is the npub (hex) the user signed in as before: the extension may since have been
 * switched to another account, so every load and save checks it is still the same one.
 */
export async function extensionSigner(expected?: string): Promise<Signer> {
  const ext = window.nostr;
  if (!ext) throw new Error('No Nostr extension found in this browser.');
  const nip44Ext = ext.nip44;
  if (!nip44Ext) throw new Error("Your Nostr extension doesn't support NIP-44 encryption.");
  const pubkey = expected ?? (await ext.getPublicKey());
  const verify = async () => {
    const now = await ext.getPublicKey();
    if (now !== pubkey) throw new KeyMismatch(pubkey, now);
  };
  return {
    method: 'extension',
    pubkey,
    verify,
    encrypt: async (plaintext) => {
      await verify();
      return nip44Ext.encrypt(pubkey, plaintext);
    },
    decrypt: (payload) => nip44Ext.decrypt(pubkey, payload),
    sign: async (template) => {
      const event = await ext.signEvent(template);
      if (event.pubkey !== pubkey) throw new KeyMismatch(pubkey, event.pubkey);
      return event;
    },
  };
}

/** Reads an nsec, or a 64 character hex key. */
export function parseSecretKey(input: string): Uint8Array {
  const value = input.trim();
  if (/^[0-9a-f]{64}$/i.test(value)) return Uint8Array.from(value.match(/../g)!.map((h) => parseInt(h, 16)));
  try {
    const decoded = nip19.decode(value);
    if (decoded.type === 'nsec') return decoded.data;
  } catch {
    // Falls through to the error below.
  }
  throw new Error("That doesn't look like a private key. It should start with nsec1.");
}

export function newSecretKey(): { secret: Uint8Array; nsec: string } {
  const secret = generateSecretKey();
  return { secret, nsec: nip19.nsecEncode(secret) };
}

export function npub(pubkey: string): string {
  return nip19.npubEncode(pubkey);
}
