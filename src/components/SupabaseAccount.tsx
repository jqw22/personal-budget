import { useState } from 'react';
import type { useCloud } from '../lib/useCloud';
import { syncLabel } from './AccountView';

/** Signing in to Supabase with an emailed link, and the state of the copy saved there. */
export function SupabaseAccount({ cloud }: { cloud: ReturnType<typeof useCloud> }) {
  const [address, setAddress] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const { email, state } = cloud;

  async function send() {
    setError(null);
    try {
      await cloud.sendLink(address);
      setSentTo(address.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (state.status !== 'signed-out') {
    return (
      <>
        <h3>Supabase</h3>
        <p>
          Signed in as <strong>{email}</strong>
        </p>
        <p className={state.status === 'error' ? 'warning' : 'muted'}>{syncLabel(state, 'Supabase')}</p>
        <div className="actions">
          <button onClick={cloud.syncNow} disabled={state.status === 'loading'}>
            Sync now
          </button>
          <button onClick={() => cloud.signOut(false)}>Sign out</button>
          {confirmClear ? (
            <>
              <button className="danger" onClick={() => cloud.signOut(true)}>
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
      </>
    );
  }

  return (
    <>
      <h3>Supabase</h3>
      <p className="muted small">
        Sign in with your email to save your budget to Supabase and open it on any device. Anything already on this device
        is copied up the first time.
      </p>
      {sentTo ? (
        <p>
          Check <strong>{sentTo}</strong> for a sign-in link, and open it in this browser.{' '}
          <button className="link inline-link" onClick={() => setSentTo(null)}>
            Use another email
          </button>
        </p>
      ) : (
        <form
          className="signin"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            aria-label="Email"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <button type="submit" className="primary" disabled={!/^\S+@\S+\.\S+$/.test(address.trim())}>
            Email me a sign-in link
          </button>
        </form>
      )}
      {error && <p className="warning">{error}</p>}
    </>
  );
}
