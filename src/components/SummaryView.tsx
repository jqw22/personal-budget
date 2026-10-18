import { useMemo, useState } from 'react';
import { formatMoney, formatMonth } from '../lib/format';
import { categoryHistory, monthsWithData, UNTAGGED } from '../lib/summary';
import type { BudgetData } from '../lib/types';

interface Props {
  data: BudgetData;
  /** Opens the transactions for a month and category; null means untagged. */
  onShowTransactions: (month: string, category: string | null) => void;
}

/** How many months the category table shows, ending at the chosen month. */
const MONTHS_SHOWN = 4;

function shortMonth(month: string): string {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short' });
}

export function SummaryView({ data, onShowTransactions }: Props) {
  const months = useMemo(() => monthsWithData(data.transactions), [data.transactions]);
  const [month, setMonth] = useState(() => months.at(-1) ?? '');
  const history = useMemo(() => (month ? categoryHistory(data.transactions, month, MONTHS_SHOWN) : null), [
    data.transactions,
    month,
  ]);

  if (months.length === 0) {
    return (
      <section>
        <h2>Summary</h2>
        <p className="muted">No transactions yet. Import a CSV to get started.</p>
      </section>
    );
  }

  const index = months.indexOf(month);
  const withData = new Set(months);
  const untaggedSpent = history?.rows.find((r) => r.category === UNTAGGED)?.amounts.at(-1) ?? 0;
  const monthTransactions = data.transactions.filter((t) => t.date.startsWith(month));
  const firstDay = Number(monthTransactions[0]?.date.slice(8));
  const lastDay = Number(monthTransactions.at(-1)?.date.slice(8));
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const partial = monthTransactions.length > 0 && (firstDay > 1 || lastDay < daysInMonth);

  return (
    <section>
      <div className="month-picker">
        <button aria-label="Previous month" disabled={index <= 0} onClick={() => setMonth(months[index - 1])}>
          ‹
        </button>
        <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
          {months.map((m) => (
            <option key={m} value={m}>
              {formatMonth(m)}
            </option>
          ))}
        </select>
        <button
          aria-label="Next month"
          disabled={index >= months.length - 1}
          onClick={() => setMonth(months[index + 1])}
        >
          ›
        </button>
      </div>

      {partial && (
        <p className="muted small">
          Only covers {firstDay}–{lastDay} {formatMonth(month)}, from the statements imported so far.
        </p>
      )}

      {untaggedSpent > 0 && (
        <p className="warning">
          {formatMoney(untaggedSpent)} this month isn't tagged yet.{' '}
          <button className="link inline-link" onClick={() => onShowTransactions(month, null)}>
            Tag it now
          </button>
        </p>
      )}

      <h2>Income and spending</h2>
      {!history || history.rows.length === 0 ? (
        <p className="muted">No spending in these months.</p>
      ) : (
        <div className="table-wrap">
          <table className="summary">
            <thead>
              <tr>
                <th>Category</th>
                {history.months.map((m) => (
                  <th key={m} className="num">
                    {shortMonth(m)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="income-row">
                <td>
                  <button
                    className="link name"
                    title="See Income transactions"
                    onClick={() => onShowTransactions(month, 'Income')}
                  >
                    Income
                  </button>
                </td>
                {history.income.map((amount, i) => (
                  <td key={history.months[i]} className="num">
                    {withData.has(history.months[i]) ? formatMoney(amount) : '–'}
                  </td>
                ))}
              </tr>
              <tr className="section">
                <th colSpan={history.months.length + 1}>Spending</th>
              </tr>
              {history.rows.map((r) => {
                return (
                  <tr key={r.category} className={r.category === UNTAGGED ? 'untagged' : ''}>
                    <td>
                      <button
                        className="link name"
                        title={`See ${r.category} transactions`}
                        onClick={() => onShowTransactions(month, r.category === UNTAGGED ? null : r.category)}
                      >
                        {r.category}
                      </button>
                    </td>
                    {r.amounts.map((amount, i) => (
                      <td key={history.months[i]} className={`num ${i < r.amounts.length - 1 ? 'muted' : ''}`}>
                        {withData.has(history.months[i]) ? formatMoney(amount) : '–'}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th>Total spending</th>
                {history.totals.map((total, i) => (
                  <th key={history.months[i]} className="num">
                    {withData.has(history.months[i]) ? formatMoney(total) : '–'}
                  </th>
                ))}
              </tr>
              <tr className="net-row">
                <th>Under / over spend</th>
                {history.totals.map((total, i) => {
                  const net = history.income[i] - total;
                  return (
                    <th key={history.months[i]} className={`num ${!withData.has(history.months[i]) ? '' : net >= 0 ? 'down' : 'up'}`}>
                      {withData.has(history.months[i]) ? `${net >= 0 ? '+' : '−'}${formatMoney(Math.abs(net))}` : '–'}
                    </th>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
