import { useRef, useState } from 'react';
import { newSecretKey, npub, shortNpub } from '../lib/nostr';
import { download, impliedOpeningBalance, runningBalances, toCsv } from '../lib/export';
import { emptyData, parseBackup } from '../lib/store';
import type { BudgetData } from '../lib/types';
import type { useSync } from '../lib/useSync';

interface Props {
  sync: ReturnType<typeof useSync>;
  data: BudgetData;
  onChange: (data: BudgetData) => void;
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
  const today = new Date().toISOString().slice(0, 10);
  function downloadTransactions() {
    const opening = impliedOpeningBalance(data.transactions);
    download(`transactions-all-${today}.csv`, toCsv(data.transactions, opening === null ? undefined : runningBalances(data.transactions, opening)));
  }
  function downloadEverything() {
    download(`personal-budget-backup-${today}.json`, JSON.stringify(data, null, 2));
  }
  const { signer, state, account } = sync;
  const [nsec, setNsec] = useState('');
  const [remember, setRemember] = useState(true);
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [relays, setRelays] = useState(account.relays.join('\n'));
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmAgain, setConfirmAgain] = useState(false);
  const [restore, setRestore] = useState<{ data: BudgetData; name: string } | null>(null);
  const [restoreError, setRestoreError] = useState('');
  const backupInput = useRef<HTMLInputElement>(null);
  async function pickBackup(file: File | undefined) {
    if (!file) return;
    const backup = parseBackup(await file.text());
    setRestoreError(backup ? '' : `${file.name} isn't a backup file from this app.`);
    setRestore(backup && { data: backup, name: file.name });
  }

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


  const dataSettings = (
    <>
      <h2>Your data</h2>
      <p className="muted">Everything is saved in this browser{signer ? ' and synced to your relays' : ''}.</p>
      {confirmClear ? (
        <p>
          Delete your budget from this browser?{signer ? ' This signs you out. The encrypted copy on your relays stays, so you can sign back in to get it.' : ''}{' '}
          <button
            className="danger"
            onClick={() => {
              if (signer) sync.signOut(true);
              else onChange(emptyData());
              setConfirmClear(false);
            }}
          >
            Yes, delete from this browser
          </button>{' '}
          <button onClick={() => setConfirmClear(false)}>Cancel</button>
        </p>
      ) : confirmAgain ? (
        <p>
          <strong>Are you sure?</strong> Your budget will be gone from this browser and your relays, and only a downloaded copy
          can bring it back.{' '}
          <button
            className="danger"
            onClick={() => {
              onChange(emptyData());
              setConfirmAgain(false);
            }}
          >
            Yes, I'm sure
          </button>{' '}
          <button onClick={() => setConfirmAgain(false)}>Cancel</button>
        </p>
      ) : confirmReset ? (
        <p>
          Delete all transactions, rules and categories from this browser and your relays? This can't be undone, so
          download a copy first:{' '}
          <button onClick={downloadTransactions} disabled={data.transactions.length === 0}>
            Transactions (CSV)
          </button>{' '}
          <button onClick={downloadEverything}>Everything (backup file)</button>
          <br />
          <button
            className="danger"
            onClick={() => {
              setConfirmReset(false);
              setConfirmAgain(true);
            }}
          >
            Yes, delete everywhere
          </button>{' '}
          <button onClick={() => setConfirmReset(false)}>Cancel</button>
        </p>
      ) : restore ? (
        <p>
          Replace the budget in this browser with {restore.name} ({restore.data.transactions.length} transactions)?
          {signer ? ' It will then be saved to the relays for the key you are signed in with.' : ' Sign in afterwards to save it to your relays under any key.'}{' '}
          <button
            className="danger"
            onClick={() => {
              onChange(restore.data);
              setRestore(null);
            }}
          >
            Yes, restore
          </button>{' '}
          <button onClick={() => setRestore(null)}>Cancel</button>
        </p>
      ) : (
        <div className="actions">
          <button onClick={() => backupInput.current?.click()}>Restore from backup…</button>
          <input
            ref={backupInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              void pickBackup(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <button onClick={() => setConfirmClear(true)}>Delete browser data…</button>
          {signer && <button onClick={() => setConfirmReset(true)}>Delete browser and relay data…</button>}
        </div>
      )}
      {restoreError && <p className="warning">{restoreError}</p>}
    </>
  );

  const relaySettings = (
    <>
      <h3>Relays</h3>
      <p className="muted small">The Nostr relays your encrypted data is saved to, one per line.</p>
      {signer && <RelayTable sync={sync} />}
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
        </div>
        {relaySettings}
        {dataSettings}
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
      {relaySettings}
      {dataSettings}
    </section>
  );
}

/** A relay's reason for turning a save down, in plain words. */
function refusal(error: string): string {
  if (/connection|connect/i.test(error)) return "couldn't connect";
  if (/timed? ?out/i.test(error)) return 'no answer';
  return error.replace(/^(blocked|restricted|rate-limited|invalid|error|pow|duplicate):\s*/i, '');
}

/** One row per relay: whether it's reachable, what it serves back, and how it took the last save. */
function RelayTable({ sync }: { sync: Props['sync'] }) {
  const { account, checks, checking, saveResults, state, checkRelays, filling, filled, fillRelays } = sync;
  // A relay that's reachable but missing records, or holding older ones, can be filled in from the others.
  const gaps = checks?.some((c) => c.connected && (c.held < c.expected || c.behind > 0)) ?? false;
  const filledCount = filled ? [...filled.values()].reduce((t, n) => t + n, 0) : 0;
  const ready = state.status === 'saved' || state.status === 'saving' || state.status === 'error';

  return (
    <>
      <table className="relay-table">
        <thead>
          <tr>
            <th>Relay</th>
            <th>Connected</th>
            <th>Holds</th>
            <th>Up to date</th>
            <th>Last save</th>
          </tr>
        </thead>
        <tbody>
          {account.relays.map((url) => {
            const check = checks?.find((c) => c.url === url);
            const saved = saveResults.get(url);
            const missing = check ? check.expected - check.held : 0;
            return (
              <tr key={url}>
                <td>{url.replace(/^wss?:\/\//, '')}</td>
                <td className={check && !check.connected ? 'warning' : undefined}>
                  {checking || !check ? '…' : check.connected ? 'Yes' : 'No'}
                </td>
                <td className={check?.connected && missing > 0 ? 'warning' : undefined}>
                  {checking || !check?.connected ? '' : `${check.held} of ${check.expected}`}
                </td>
                <td className={check?.connected && (missing > 0 || check.behind > 0) ? 'warning' : undefined}>
                  {checking || !check?.connected
                    ? ''
                    : missing === 0 && check.behind === 0
                      ? 'Yes'
                      : [check.behind > 0 && `${check.behind} older`, missing > 0 && `${missing} missing`]
                          .filter(Boolean)
                          .join(', ')}
                </td>
                <td className={saved && saved.failed > 0 ? 'warning' : undefined} title={saved?.error}>
                  {!saved
                    ? 'No save yet'
                    : saved.failed > 0
                      ? `Refused ${saved.failed}${saved.error ? `: ${refusal(saved.error)}` : ''}`
                      : saved.accepted > 0
                        ? `Accepted ${saved.accepted}`
                        : 'Waiting…'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="relay-check">
        <button onClick={() => void checkRelays()} disabled={checking || !ready}>
          {checking ? 'Checking…' : 'Check relays'}
        </button>
        {(gaps || filling) && (
          <button
            title="Send each relay the records it's missing, copied from the relays that have them"
            onClick={() => void fillRelays()}
            disabled={checking || filling || !ready}
          >
            {filling ? 'Sending…' : 'Send missing records'}
          </button>
        )}
        {filled && !filling && !checking && (
          <span className="muted">
            {filledCount ? `Sent ${filledCount} record${filledCount === 1 ? '' : 's'}.` : 'Nothing was sent: the relays refused or already had them.'}
          </span>
        )}
      </div>
    </>
  );
}
