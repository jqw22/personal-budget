import { useMemo, useState } from 'react';
import { formatDate, formatMoney, formatMonth } from '../lib/format';
import { applyRules, upsertRule } from '../lib/rules';
import type { BudgetData, Transaction } from '../lib/types';

interface Props {
  data: BudgetData;
  onChange: (data: BudgetData) => void;
  /** Filters to open with, e.g. when coming from the summary. */
  initialFilter?: TransactionFilter;
}

/** Category filter value that shows only untagged transactions. */
export const UNTAGGED_FILTER = '__untagged__';

export interface TransactionFilter {
  month: string;
  /** A category name, 'all', or UNTAGGED_FILTER. */
  category: string;
}

/** Newest first, biggest money out first, or biggest money in first. */
type Sort = 'date' | 'amount-out' | 'amount-in';

const NEXT_AMOUNT_SORT: Record<Sort, Sort> = { date: 'amount-out', 'amount-out': 'amount-in', 'amount-in': 'date' };

export function TransactionsView({ data, onChange, initialFilter }: Props) {
  const months = useMemo(
    () => [...new Set(data.transactions.map((t) => t.date.slice(0, 7)))].sort().reverse(),
    [data.transactions],
  );
  const [month, setMonth] = useState<string>(initialFilter?.month ?? 'all');
  const [category, setCategory] = useState<string>(initialFilter?.category ?? 'all');
  const [remember, setRemember] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('date');

  const shown = data.transactions
    .filter((t) => month === 'all' || t.date.startsWith(month))
    .filter((t) => category === 'all' || (category === UNTAGGED_FILTER ? !t.category : t.category === category))
    .filter((t) => !search || t.description.toLowerCase().includes(search.toLowerCase()))
    .slice()
    .reverse();
  if (sort !== 'date') shown.sort((a, b) => (sort === 'amount-out' ? a.amount - b.amount : b.amount - a.amount));

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
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="all">All categories</option>
          <option value={UNTAGGED_FILTER}>Untagged</option>
          {data.categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input type="search" placeholder="Search descriptions" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label title="When you tag a transaction, tag every other transaction from the same place the same way">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember for this merchant
        </label>
      </div>
      {shown.length > 0 && (month !== 'all' || category !== 'all' || search) && (
        <p className="muted small">
          {shown.length} transaction{shown.length === 1 ? '' : 's'}, totalling{' '}
          {formatMoney(shown.reduce((total, t) => total + t.amount, 0))}
        </p>
      )}
      <div className="table-wrap">
        <table className="transactions">
          <thead>
            <tr>
              <th aria-sort={sort === 'date' ? 'descending' : undefined}>
                <button className="link sort" title="Sort by date, newest first" onClick={() => setSort('date')}>
                  Date{sort === 'date' && ' ▼'}
                </button>
              </th>
              <th>Merchant</th>
              <th className="num" aria-sort={sort === 'date' ? undefined : sort === 'amount-out' ? 'ascending' : 'descending'}>
                <button
                  className="link sort"
                  title={
                    sort === 'amount-out' ? 'Sort with biggest money in first' : sort === 'amount-in' ? 'Sort by date' : 'Sort with biggest spend first'
                  }
                  onClick={() => setSort(NEXT_AMOUNT_SORT[sort])}
                >
                  Amount{sort === 'amount-out' ? ' ▼' : sort === 'amount-in' ? ' ▲' : ''}
                </button>
              </th>
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
