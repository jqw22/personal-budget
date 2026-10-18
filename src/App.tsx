import { useEffect, useState } from 'react';
import { ImportView } from './components/ImportView';
import { RulesView } from './components/RulesView';
import { TransactionsView } from './components/TransactionsView';
import { loadData, saveData } from './lib/store';
import type { BudgetData } from './lib/types';

type Tab = 'import' | 'transactions' | 'rules';

export function App() {
  const [data, setData] = useState<BudgetData>(loadData);
  const [tab, setTab] = useState<Tab>(() => (data.transactions.length ? 'transactions' : 'import'));

  useEffect(() => saveData(data), [data]);

  const untagged = data.transactions.filter((t) => !t.category).length;

  return (
    <div className="app">
      <header>
        <h1>Personal Budget</h1>
        <nav>
          <button className={tab === 'import' ? 'active' : ''} onClick={() => setTab('import')}>
            Import
          </button>
          <button className={tab === 'transactions' ? 'active' : ''} onClick={() => setTab('transactions')}>
            Transactions{untagged > 0 && <span className="badge">{untagged}</span>}
          </button>
          <button className={tab === 'rules' ? 'active' : ''} onClick={() => setTab('rules')}>
            Categories & rules
          </button>
        </nav>
      </header>
      <main>
        {tab === 'import' && <ImportView data={data} onChange={setData} onDone={() => setTab('transactions')} />}
        {tab === 'transactions' && <TransactionsView data={data} onChange={setData} />}
        {tab === 'rules' && <RulesView data={data} onChange={setData} />}
      </main>
    </div>
  );
}
