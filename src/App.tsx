import { useEffect, useState } from 'react';
import { AccountView, syncLabel } from './components/AccountView';
import { isTagged } from './lib/splits';
import { RulesView } from './components/RulesView';
import { SummaryView } from './components/SummaryView';
import { TransactionsView, UNTAGGED_FILTER, type TransactionFilter } from './components/TransactionsView';
import { IS_TEST_COPY } from './lib/env';
import { loadData, saveData } from './lib/store';
import type { BudgetData } from './lib/types';
import { useSync } from './lib/useSync';

type Tab = 'summary' | 'transactions' | 'categories' | 'rules' | 'account';

export function App() {
  const [data, setData] = useState<BudgetData>(loadData);
  const [tab, setTab] = useState<Tab>(() => (data.transactions.length ? 'summary' : 'transactions'));
  const [txFilter, setTxFilter] = useState<TransactionFilter | undefined>();
  /** The rule to scroll to and highlight when the Rules tab opens from a transaction. */
  const [focusRule, setFocusRule] = useState<string | null>(null);

  function openTab(next: Tab) {
    setTxFilter(undefined);
    setFocusRule(null);
    setTab(next);
  }

  const sync = useSync(data, setData);

  const [storageUsed, setStorageUsed] = useState<number | null>(0);
  useEffect(() => setStorageUsed(saveData(data)), [data]);

  const untagged = data.transactions.filter((t) => !isTagged(t)).length;

  return (
    <div className={`app ${tab === 'summary' ? 'wide' : ''}`}>
      <header>
        <div>
          <h1>
            Personal Budget{IS_TEST_COPY && <span className="test-copy">Test copy</span>}
          </h1>
          <button className={`link sync-status ${sync.state.status}`} onClick={() => openTab('account')}>
            {sync.state.status === 'signed-out' ? 'Not signed in: data is only on this device' : syncLabel(sync.state)}
          </button>
        </div>
        <nav>
          <button className={tab === 'summary' ? 'active' : ''} onClick={() => openTab('summary')}>
            Summary
          </button>
          <button className={tab === 'transactions' ? 'active' : ''} onClick={() => openTab('transactions')}>
            Transactions{untagged > 0 && <span className="badge">{untagged}</span>}
          </button>
          <button className={tab === 'categories' ? 'active' : ''} onClick={() => openTab('categories')}>
            Categories
          </button>
          <button className={tab === 'rules' ? 'active' : ''} onClick={() => openTab('rules')}>
            Rules
          </button>
          <button className={tab === 'account' ? 'active' : ''} onClick={() => openTab('account')}>
            Account
          </button>
        </nav>
      </header>
      {storageUsed === null ? (
        <p className="warning">
          This browser is out of space, so your latest changes weren't saved on this device.
          {sync.signer ? ' They are still saved, encrypted, to your relays.' : ''} Download a CSV from Transactions to keep a
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
        {tab === 'transactions' && (
          <TransactionsView
            data={data}
            onChange={setData}
            initialFilter={txFilter}
            onOpenRule={(id) => {
              setFocusRule(id);
              setTab('rules');
            }}
          />
        )}
        {tab === 'categories' && <RulesView data={data} onChange={setData} part="categories" />}
        {tab === 'rules' && <RulesView data={data} onChange={setData} part="rules" focusRule={focusRule} />}
        {tab === 'account' && <AccountView sync={sync} data={data} onChange={setData} />}
      </main>
    </div>
  );
}
