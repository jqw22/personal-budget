import { useState } from 'react';
import { newSecretKey, npub } from '../lib/nostr';
import type { BudgetData } from '../lib/types';
import type { useSync } from '../lib/useSync';

interface Props {
  sync: ReturnType<typeof useSync>;
  data: BudgetData;
  onChange: (data: BudgetData) => void;
}

function shortNpub(pubkey: string): string {
  const full = npub(pubkey);
  return `${full.slice(0, 12)}…${full.slice(-6)}`;
}

export function syncLabel(state: Props['sync']['state']): string {
  switch (state.status) {
    case 'signed-out':
      return 'Not signed in';
    case 'loading':
      return 'Loading from relays…';
    case 'saving':
      return 'Saving…';
    case 'saved':
      return `Saved, encrypted${state.savedAt ? ` at ${state.savedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}`;
    case 'error':
      return `Not saved: ${state.message}`;
  }
}

export function AccountView({ sync, data, onChange }: Props) {
  const { signer, state, account } = sync;
  const [nsec, setNsec] = useState('');
  const [remember, setRemember] = useState(true);
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [relays, setRelays] = useState(account.relays.join('\n'));
  const [confirmClear, setConfirmClear] = useState(false);

  async function attempt(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
      setNsec('');
      setCreated(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const relayList = relays
    .split(/\s+/)
    .map((r) => r.trim())
    .filter((r) => /^wss?:\/\/./.test(r));

  const claudeSettings = <ClaudeKey data={data} onChange={onChange} signedIn={Boolean(signer)} />;

  const relaySettings = (
    <>
      <h3>Relays</h3>
      <p className="muted small">The Nostr relays your encrypted data is saved to, one per line.</p>
      <textarea className="relays" rows={4} value={relays} onChange={(e) => setRelays(e.target.value)} aria-label="Relays" />
      <div>
        <button
          disabled={relayList.length === 0 || relayList.join('\n') === account.relays.join('\n')}
          onClick={() => sync.setRelays(relayList)}
        >
          Save relays
        </button>
      </div>
    </>
  );

  if (signer) {
    return (
      <section>
        <h2>Account</h2>
        <p>
          Signed in as <code title={npub(signer.pubkey)}>{shortNpub(signer.pubkey)}</code>{' '}
          <span className="muted">({signer.method === 'extension' ? 'browser extension' : 'private key'})</span>
        </p>
        <p className={state.status === 'error' ? 'warning' : 'muted'}>{syncLabel(state)}</p>
        <p className="muted small">
          Your budget is encrypted with your Nostr key (NIP-44) before it leaves this device, so relays only see
          scrambled data. Sign in with the same key on another device to see it there.
        </p>
        <div className="actions">
          <button onClick={sync.syncNow} disabled={state.status === 'loading'}>
            Sync now
          </button>
          <button onClick={() => sync.signOut(false)}>Sign out</button>
          {confirmClear ? (
            <>
              <button className="danger" onClick={() => sync.signOut(true)}>
                Yes, sign out and clear
              </button>
              <button onClick={() => setConfirmClear(false)}>Cancel</button>
            </>
          ) : (
            <button className="danger" onClick={() => setConfirmClear(true)}>
              Sign out and clear this device
            </button>
          )}
        </div>
        {confirmClear && (
          <p className="muted small">
            This removes your budget from this browser. The encrypted copy on your relays stays, so you can sign back in to
            get it.
          </p>
        )}
        {claudeSettings}
        {relaySettings}
      </section>
    );
  }

  return (
    <section>
      <h2>Account</h2>
      <p>
        Sign in with Nostr to keep an encrypted copy of your budget on Nostr relays, so it's backed up and you can open it
        on other devices. It's encrypted with your key before it leaves this device, so only you can read it.
      </p>
      {error && <p className="warning">{error}</p>}

      <h3>With a browser extension</h3>
      <p className="muted small">Works with Nostr extensions like Alby or nos2x. Your key stays in the extension.</p>
      <button className="primary" onClick={() => attempt(sync.signInWithExtension)}>
        Sign in with extension
      </button>

      <h3>With your private key</h3>
      <form
        className="signin"
        onSubmit={(e) => {
          e.preventDefault();
          attempt(() => sync.signInWithKey(nsec, remember));
        }}
      >
        <input
          type="password"
          autoComplete="off"
          placeholder="nsec1…"
          aria-label="Private key"
          value={nsec}
          onChange={(e) => setNsec(e.target.value)}
        />
        <label>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Stay signed in on this device
        </label>
        <button type="submit" disabled={!nsec.trim()}>
          Sign in
        </button>
      </form>
      <p className="muted small">
        Staying signed in keeps your key in this browser. Leave it unticked on a shared computer.
      </p>

      <h3>New to Nostr?</h3>
      {created ? (
        <div className="new-key">
          <p>
            <strong>Save this private key somewhere safe, like a password manager.</strong> It's the only way to unlock your
            data. Nobody can recover it for you.
          </p>
          <code className="nsec">{created}</code>
          <div className="actions">
            <button onClick={() => navigator.clipboard?.writeText(created)}>Copy</button>
            <button className="primary" onClick={() => attempt(() => sync.signInWithKey(created, remember))}>
              I've saved it, sign in
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setCreated(newSecretKey().nsec)}>Create a key</button>
      )}

      {claudeSettings}
      {relaySettings}
    </section>
  );
}

/** The user's own Anthropic API key, which the Insights tab uses to ask Claude for a review. */
function ClaudeKey({ data, onChange, signedIn }: { data: BudgetData; onChange: (data: BudgetData) => void; signedIn: boolean }) {
  const [key, setKey] = useState('');
  const { anthropicKey: saved, ...rest } = data;

  return (
    <>
      <h3>Dad's insights</h3>
      <p className="muted small">
        Your Anthropic API key, from{' '}
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
          console.anthropic.com
        </a>
        . It's kept with your budget
        {signedIn ? ', encrypted on your relays, so it works on your other devices too' : ' on this device'}.
      </p>
      {saved ? (
        <div className="actions saved-key">
          <code>
            {saved.slice(0, 10)}…{saved.slice(-4)}
          </code>
          <button onClick={() => onChange(rest)}>Remove key</button>
        </div>
      ) : (
        <form
          className="signin"
          onSubmit={(e) => {
            e.preventDefault();
            onChange({ ...data, anthropicKey: key.trim() });
            setKey('');
          }}
        >
          <input
            type="password"
            autoComplete="off"
            placeholder="sk-ant-…"
            aria-label="Anthropic API key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button type="submit" disabled={!key.trim().startsWith('sk-ant-')}>
            Save key
          </button>
        </form>
      )}
    </>
  );
}
