import { useEffect, useState } from 'react';
import { AccountView, syncLabel } from './components/AccountView';
import { ImportView } from './components/ImportView';
import { InsightsView } from './components/InsightsView';
import { RulesView } from './components/RulesView';
import { SummaryView } from './components/SummaryView';
import { TransactionsView, UNTAGGED_FILTER, type TransactionFilter } from './components/TransactionsView';
import { loadData, saveData } from './lib/store';
import type { BudgetData } from './lib/types';
import { useCloud } from './lib/useCloud';
import { useSync } from './lib/useSync';

type Tab = 'summary' | 'insights' | 'import' | 'transactions' | 'rules' | 'account';

export function App() {
  const [data, setData] = useState<BudgetData>(loadData);
  const [tab, setTab] = useState<Tab>(() => (data.transactions.length ? 'summary' : 'import'));
  const [txFilter, setTxFilter] = useState<TransactionFilter | undefined>();

  function openTab(next: Tab) {
    setTxFilter(undefined);
    setTab(next);
  }

  const sync = useSync(data, setData);
  const cloud = useCloud(data, setData);
  const cloudOn = cloud.state.status !== 'signed-out';

  const [storageUsed, setStorageUsed] = useState<number | null>(0);
  useEffect(() => setStorageUsed(saveData(data)), [data]);

  const untagged = data.transactions.filter((t) => !t.category).length;

  return (
    <div className="app">
      <header>
        <div>
          <h1>Personal Budget</h1>
          <button className={`link sync-status ${cloudOn ? cloud.state.status : sync.state.status}`} onClick={() => openTab('account')}>
            {cloudOn
              ? syncLabel(cloud.state, 'Supabase')
              : sync.state.status === 'signed-out'
                ? 'Not signed in: data is only on this device'
                : syncLabel(sync.state)}
          </button>
        </div>
        <nav>
          <button className={tab === 'summary' ? 'active' : ''} onClick={() => openTab('summary')}>
            Summary
          </button>
          <button className={tab === 'insights' ? 'active' : ''} onClick={() => openTab('insights')}>
            Insights
          </button>
          <button className={tab === 'transactions' ? 'active' : ''} onClick={() => openTab('transactions')}>
            Transactions{untagged > 0 && <span className="badge">{untagged}</span>}
          </button>
          <button className={tab === 'import' ? 'active' : ''} onClick={() => openTab('import')}>
            Import
          </button>
          <button className={tab === 'rules' ? 'active' : ''} onClick={() => openTab('rules')}>
            Categories & rules
          </button>
          <button className={tab === 'account' ? 'active' : ''} onClick={() => openTab('account')}>
            Account
          </button>
        </nav>
      </header>
      {storageUsed === null ? (
        <p className="warning">
          This browser is out of space, so your latest changes weren't saved on this device.
          {cloudOn ? ' They are still saved to Supabase.' : sync.signer ? ' They are still saved, encrypted, to your relays.' : ''} Download a CSV from Transactions to keep a
          copy.
        </p>
      ) : (
        storageUsed > 0.8 && (
          <p className="warning">
            This browser's storage for the app is about {Math.round(storageUsed * 100)}% full. Download a CSV from
            Transactions to keep a copy before it runs out.
          </p>
        )
      )}
      <main>
        {tab === 'summary' && (
          <SummaryView
            data={data}
            onChange={setData}
            onShowTransactions={(month, category) => {
              setTxFilter({ month, category: category ?? UNTAGGED_FILTER });
              setTab('transactions');
            }}
          />
        )}
        {tab === 'insights' && (
          <InsightsView
            data={data}
            onChange={setData}
            onInsight={(insight) => setData((current) => ({ ...current, insight }))}
            onOpenAccount={() => openTab('account')}
          />
        )}
        {tab === 'import' && <ImportView data={data} onChange={setData} onDone={() => openTab('transactions')} />}
        {tab === 'transactions' && <TransactionsView data={data} onChange={setData} initialFilter={txFilter} />}
        {tab === 'rules' && <RulesView data={data} onChange={setData} />}
        {tab === 'account' && <AccountView sync={sync} cloud={cloud} data={data} onChange={setData} />}
      </main>
    </div>
  );
}
