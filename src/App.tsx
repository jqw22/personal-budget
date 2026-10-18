import { useEffect, useState } from 'react';
import { AccountView, syncLabel } from './components/AccountView';
import { ImportView } from './components/ImportView';
import { RulesView } from './components/RulesView';
import { SummaryView } from './components/SummaryView';
import { TransactionsView, UNTAGGED_FILTER, type TransactionFilter } from './components/TransactionsView';
import { loadData, saveData } from './lib/store';
import type { BudgetData } from './lib/types';
import { useSync } from './lib/useSync';

type Tab = 'summary' | 'import' | 'transactions' | 'rules' | 'account';

export function App() {
  const [data, setData] = useState<BudgetData>(loadData);
  const [tab, setTab] = useState<Tab>(() => (data.transactions.length ? 'summary' : 'import'));
  const [txFilter, setTxFilter] = useState<TransactionFilter | undefined>();

  function openTab(next: Tab) {
    setTxFilter(undefined);
    setTab(next);
  }

  const sync = useSync(data, setData);

  useEffect(() => saveData(data), [data]);

  const untagged = data.transactions.filter((t) => !t.category).length;

  return (
    <div className="app">
      <header>
        <div>
          <h1>Personal Budget</h1>
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
      <main>
        {tab === 'summary' && (
          <SummaryView
            data={data}
            onShowTransactions={(month, category) => {
              setTxFilter({ month, category: category ?? UNTAGGED_FILTER });
              setTab('transactions');
            }}
          />
        )}
        {tab === 'import' && <ImportView data={data} onChange={setData} onDone={() => openTab('transactions')} />}
        {tab === 'transactions' && <TransactionsView data={data} onChange={setData} initialFilter={txFilter} />}
        {tab === 'rules' && <RulesView data={data} onChange={setData} />}
        {tab === 'account' && <AccountView sync={sync} />}
      </main>
    </div>
  );
}
