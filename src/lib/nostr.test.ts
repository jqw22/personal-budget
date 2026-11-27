import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, nip44 } from 'nostr-tools';
import { extensionSigner, KeyMismatch } from './nostr';

/** A pretend NIP-07 extension whose account can be switched, like Alby or nos2x. */
function fakeExtension() {
  const a = generateSecretKey();
  const b = generateSecretKey();
  const ext = { secret: a };
  (globalThis as { window?: unknown }).window = {
    nostr: {
      getPublicKey: async () => getPublicKey(ext.secret),
      signEvent: async (t: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(t, ext.secret),
      nip44: {
        encrypt: async (pk: string, text: string) => nip44.encrypt(text, nip44.getConversationKey(ext.secret, pk)),
        decrypt: async (pk: string, data: string) => nip44.decrypt(data, nip44.getConversationKey(ext.secret, pk)),
      },
    },
  };
  return { ext, a, b };
}

describe('extensionSigner', () => {
  it('works while the extension stays on the signed-in npub', async () => {
    const { a } = fakeExtension();
    const signer = await extensionSigner();
    expect(signer.pubkey).toBe(getPublicKey(a));
    await signer.verify();
    const event = await signer.sign({ kind: 1, created_at: 1, tags: [], content: await signer.encrypt('hi') });
    expect(event.pubkey).toBe(signer.pubkey);
  });

  it('refuses to encrypt or sign once the extension switches to another npub', async () => {
    const { ext, b } = fakeExtension();
    const signer = await extensionSigner();
    ext.secret = b;
    await expect(signer.verify()).rejects.toBeInstanceOf(KeyMismatch);
    await expect(signer.encrypt('hi')).rejects.toBeInstanceOf(KeyMismatch);
    await expect(signer.sign({ kind: 1, created_at: 1, tags: [], content: '' })).rejects.toBeInstanceOf(KeyMismatch);
  });

  it('signs back in as the remembered npub, not whatever the extension is on now', async () => {
    const { a, b, ext } = fakeExtension();
    ext.secret = b;
    const signer = await extensionSigner(getPublicKey(a));
    expect(signer.pubkey).toBe(getPublicKey(a));
    await expect(signer.verify()).rejects.toThrow(/Switch your extension back/);
  });
});
