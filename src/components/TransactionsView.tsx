import { useMemo, useState } from 'react';
import { formatDate, formatMoney, formatMonth } from '../lib/format';
import { applyRules, upsertRule } from '../lib/rules';
import type { BudgetData, Transaction } from '../lib/types';

interface Props {
  data: BudgetData;
  onChange: (data: BudgetData) => void;
  /** Filters to open with, e.g. when coming from the summary's "Tag it now". */
  initialFilter?: { month: string; onlyUntagged: boolean };
}

export function TransactionsView({ data, onChange, initialFilter }: Props) {
  const months = useMemo(
    () => [...new Set(data.transactions.map((t) => t.date.slice(0, 7)))].sort().reverse(),
    [data.transactions],
  );
  const [month, setMonth] = useState<string>(initialFilter?.month ?? 'all');
  const [onlyUntagged, setOnlyUntagged] = useState(initialFilter?.onlyUntagged ?? false);
  const [remember, setRemember] = useState(true);
  const [search, setSearch] = useState('');

  const shown = data.transactions
    .filter((t) => month === 'all' || t.date.startsWith(month))
    .filter((t) => !onlyUntagged || !t.category)
    .filter((t) => !search || t.description.toLowerCase().includes(search.toLowerCase()))
    .slice()
    .reverse();

  function tag(t: Transaction, category: string) {
    if (!category) {
      // Clearing a tag hands the transaction back to the rules.
      const transactions = data.transactions.map((x) =>
        x.id === t.id ? { ...x, category: null, categorySource: null } : x,
      );
      onChange({ ...data, transactions: applyRules(transactions, data.rules) });
      return;
    }
    const transactions = data.transactions.map((x) =>
      x.id === t.id ? { ...x, category, categorySource: 'manual' as const } : x,
    );
    if (!remember) {
      onChange({ ...data, transactions });
      return;
    }
    const rules = upsertRule(data.rules, t.merchant, category);
    onChange({ ...data, rules, transactions: applyRules(transactions, rules) });
  }

  if (data.transactions.length === 0) {
    return (
      <section>
        <h2>Transactions</h2>
        <p className="muted">No transactions yet. Import a CSV to get started.</p>
      </section>
    );
  }

  const untagged = data.transactions.filter((t) => !t.category).length;

  return (
    <section>
      <h2>Transactions</h2>
      <p className="muted">
        {untagged === 0 ? 'Everything is tagged.' : `${untagged} of ${data.transactions.length} still need a category.`}
      </p>
      <div className="filters">
        <select value={month} onChange={(e) => setMonth(e.target.value)}>
          <option value="all">All months</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {formatMonth(m)}
            </option>
          ))}
        </select>
        <input type="search" placeholder="Search descriptions" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label>
          <input type="checkbox" checked={onlyUntagged} onChange={(e) => setOnlyUntagged(e.target.checked)} />
          Only untagged
        </label>
        <label title="When you tag a transaction, tag every other transaction from the same place the same way">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember for this merchant
        </label>
      </div>
      <div className="table-wrap">
        <table className="transactions">
          <thead>
            <tr>
              <th>Date</th>
              <th>Merchant</th>
              <th className="num">Amount</th>
              <th>Category</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => (
              <tr key={t.id} className={t.category ? '' : 'untagged'}>
                <td className="nowrap">{formatDate(t.date)}</td>
                <td title={t.description}>
                  {t.merchant}
                  <div className="sub">{t.description}</div>
                </td>
                <td className={`num ${t.amount > 0 ? 'in' : ''}`}>{formatMoney(t.amount)}</td>
                <td>
                  <select value={t.category ?? ''} onChange={(e) => tag(t, e.target.value)}>
                    <option value="">Untagged</option>
                    {data.categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  {t.categorySource === 'rule' && <span className="hint" title="Tagged by a merchant rule">auto</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length === 0 && <p className="muted">Nothing matches these filters.</p>}
    </section>
  );
}
