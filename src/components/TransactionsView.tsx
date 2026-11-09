import { Fragment, useMemo, useState } from 'react';
import { AutoTag } from './AutoTag';
import { formatDate, formatMoney, formatMonth } from '../lib/format';
import { applyRules, upsertRule } from '../lib/rules';
import { download, impliedOpeningBalance, runningBalances, toCsv } from '../lib/export';
import { parseMoney } from '../lib/importer';
import { amountIn, isTagged, splitProblem, withSplit } from '../lib/splits';
import { sortedCategories } from '../lib/store';
import type { BudgetData, Split, Transaction } from '../lib/types';

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
  const [remember, setRemember] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('date');
  /** The transaction whose split is being edited. */
  const [splitting, setSplitting] = useState<string | null>(null);

  const shown = data.transactions
    .filter((t) => month === 'all' || t.date.startsWith(month))
    .filter(
      (t) =>
        category === 'all' ||
        (category === UNTAGGED_FILTER ? !isTagged(t) : t.category === category || t.splits?.some((p) => p.category === category)),
    )
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

  function split(t: Transaction, parts: Split[] | null) {
    const transactions = data.transactions.map((x) => (x.id === t.id ? withSplit(x, parts) : x));
    // Without its split, the transaction goes back to the rules like any untagged one.
    onChange({ ...data, transactions: parts ? transactions : applyRules(transactions, data.rules) });
    setSplitting(null);
  }

  if (data.transactions.length === 0) {
    return (
      <section>
        <h2>Transactions</h2>
        <p className="muted">No transactions yet. Import a CSV to get started.</p>
      </section>
    );
  }

  // Worked back from the bank's own balance column in the imported statements.
  const opening = impliedOpeningBalance(data.transactions);
  // Worked out over every transaction, so a filtered download still shows the real balance on each row.
  const balances = opening === null ? null : runningBalances(data.transactions, opening);
  const untagged = data.transactions.filter((t) => !isTagged(t)).length;
  const categories = sortedCategories(data.categories);

  return (
    <section>
      <h2>Transactions</h2>
      <p className="muted">
        {untagged === 0 ? 'Everything is tagged.' : `${untagged} of ${data.transactions.length} still need a category.`}
      </p>
      {untagged > 0 && <AutoTag data={data} onChange={onChange} />}
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
          {categories.map((c) => (
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
        <button
          disabled={shown.length === 0}
          title="Download the transactions shown below as a CSV file, oldest first unless sorted by amount"
          onClick={() =>
            download(
              `transactions-${month === 'all' ? 'all' : month}-${new Date().toISOString().slice(0, 10)}.csv`,
              toCsv(sort === 'date' ? [...shown].reverse() : shown, balances ?? undefined),
            )
          }
        >
          Download CSV
        </button>
      </div>
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
            {shown.length > 0 && (
              <tr className="total-row">
                <th colSpan={2}>
                  Total of {shown.length} transaction{shown.length === 1 ? '' : 's'}
                </th>
                <th className="num">
                  {/* Filtered to one category, a split counts only its parts in that category. */}
                  {formatMoney(shown.reduce((total, t) => total + (category === 'all' || category === UNTAGGED_FILTER ? t.amount : amountIn(t, category)), 0))}
                </th>
                <th />
              </tr>
            )}
            {shown.map((t) => (
              <Fragment key={t.id}>
                <tr className={isTagged(t) ? '' : 'untagged'}>
                  <td className="nowrap">{formatDate(t.date)}</td>
                  <td title={t.description}>
                    {t.merchant}
                    <div className="sub">{t.description}</div>
                  </td>
                  <td className={`num ${t.amount > 0 ? 'in' : ''}`}>{formatMoney(t.amount)}</td>
                  <td>
                    {t.splits?.length ? (
                      <div className="split-parts">
                        {t.splits.map((p, i) => (
                          <div key={i}>
                            {p.category} <span className="muted">{formatMoney(p.amount)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <select value={t.category ?? ''} onChange={(e) => tag(t, e.target.value)}>
                        <option value="">Untagged</option>
                        {categories.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    )}
                    {t.categorySource === 'rule' && <span className="hint" title="Tagged by a merchant rule">auto</span>}
                    <button
                      className="link split-button"
                      title={t.splits?.length ? 'Change or remove this split' : 'Split into two parts with different categories'}
                      onClick={() => setSplitting(splitting === t.id ? null : t.id)}
                    >
                      {t.splits?.length ? 'Edit split' : 'Split'}
                    </button>
                  </td>
                </tr>
                {splitting === t.id && (
                  <tr className="split-row">
                    <td colSpan={4}>
                      <SplitEditor t={t} categories={categories} onSave={(parts) => split(t, parts)} onCancel={() => setSplitting(null)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length === 0 && <p className="muted">Nothing matches these filters.</p>}
    </section>
  );
}

/**
 * Splits one transaction into two parts with their own categories. The first part's amount is
 * typed in and the second is whatever is left, so the two always add up to the whole.
 */
function SplitEditor({
  t,
  categories,
  onSave,
  onCancel,
}: {
  t: Transaction;
  categories: string[];
  onSave: (parts: Split[] | null) => void;
  onCancel: () => void;
}) {
  const sign = Math.sign(t.amount) || -1;
  const whole = Math.abs(t.amount);
  const [first, setFirst] = useState(t.splits ? (Math.abs(t.splits[0].amount) / 100).toFixed(2) : '');
  const [firstCategory, setFirstCategory] = useState(t.splits?.[0].category ?? t.category ?? '');
  const [secondCategory, setSecondCategory] = useState(t.splits?.[1]?.category ?? '');
  const typed = parseMoney(first);
  const firstPence = typed === null ? null : Math.abs(typed);
  const parts: Split[] | null =
    firstPence === null ? null : [
      { amount: sign * firstPence, category: firstCategory },
      { amount: sign * (whole - firstPence), category: secondCategory },
    ];
  const problem = parts ? splitProblem(t, parts) : first.trim() ? 'Type an amount for the first part.' : null;
  const pick = (value: string, set: (v: string) => void, label: string) => (
    <select value={value} onChange={(e) => set(e.target.value)} aria-label={label}>
      <option value="">Choose…</option>
      {categories.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );

  return (
    <div className="split-editor">
      <div>
        <input
          className="forecast-input"
          inputMode="decimal"
          aria-label="First part"
          placeholder="0.00"
          value={first}
          autoFocus
          onChange={(e) => setFirst(e.target.value)}
        />
        {pick(firstCategory, setFirstCategory, 'First part category')}
      </div>
      <div>
        <span className="split-rest">{firstPence === null || firstPence > whole ? '–' : formatMoney(sign * (whole - firstPence))}</span>
        {pick(secondCategory, setSecondCategory, 'Second part category')}
      </div>
      <div className="split-actions">
        <span className="muted small">
          {problem ?? (parts ? `Adds up to ${formatMoney(t.amount)}.` : `Split ${formatMoney(t.amount)} into two parts.`)}
        </span>
        <button className="primary" disabled={!parts || problem !== null} onClick={() => parts && onSave(parts)}>
          Save split
        </button>
        {t.splits?.length ? <button onClick={() => onSave(null)}>Remove split</button> : null}
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
