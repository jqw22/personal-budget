import { finalizeEvent, generateSecretKey, getPublicKey, nip19, nip44, type Event, type EventTemplate } from 'nostr-tools';

/** Signs and encrypts as the signed-in Nostr user. Data is encrypted to the user's own key. */
export interface Signer {
  method: 'extension' | 'key';
  /** Hex public key. */
  pubkey: string;
  encrypt(plaintext: string): Promise<string>;
  decrypt(payload: string): Promise<string>;
  sign(template: EventTemplate): Promise<Event>;
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
  };
}

/** Uses a NIP-07 browser extension such as Alby or nos2x, which keeps the key to itself. */
export async function extensionSigner(): Promise<Signer> {
  const ext = window.nostr;
  if (!ext) throw new Error('No Nostr extension found in this browser.');
  const nip44Ext = ext.nip44;
  if (!nip44Ext) throw new Error("Your Nostr extension doesn't support NIP-44 encryption.");
  const pubkey = await ext.getPublicKey();
  return {
    method: 'extension',
    pubkey,
    encrypt: (plaintext) => nip44Ext.encrypt(pubkey, plaintext),
    decrypt: (payload) => nip44Ext.decrypt(pubkey, payload),
    sign: (template) => ext.signEvent(template),
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
