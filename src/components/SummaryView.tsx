import { useMemo, useState } from 'react';
import { formatMoney, formatMonth } from '../lib/format';
import { categoryHistory, monthsWithData, NOT_SPENDING, summarise, UNTAGGED } from '../lib/summary';
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

function Change({ now, before }: { now: number; before: number }) {
  if (before === 0) return <span className="muted">{now === 0 ? '' : 'new'}</span>;
  const diff = now - before;
  if (diff === 0) return <span className="muted">same</span>;
  const pct = Math.round((Math.abs(diff) / Math.abs(before)) * 100);
  // Spending more reads as a warning, spending less as good news.
  return (
    <span className={diff > 0 ? 'up' : 'down'} title={`${diff > 0 ? '+' : '−'}${formatMoney(Math.abs(diff))}`}>
      {diff > 0 ? '▲' : '▼'} {pct}%
    </span>
  );
}

export function SummaryView({ data, onShowTransactions }: Props) {
  const months = useMemo(() => monthsWithData(data.transactions), [data.transactions]);
  const [month, setMonth] = useState(() => months.at(-1) ?? '');
  const summary = useMemo(() => summarise(data.transactions, month), [data.transactions, month]);
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
  const hasPrevious = months.includes(summary.previousMonth);
  const withData = new Set(months);
  const untagged = summary.lines.find((l) => l.category === UNTAGGED);
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

      <div className="stats">
        <div className="stat">
          <div className="label">Income</div>
          <div className="value">{formatMoney(summary.income)}</div>
          <div className="sub">Tagged as Income</div>
        </div>
        <div className="stat">
          <div className="label">Spent</div>
          <div className="value">{formatMoney(summary.spent)}</div>
          <div className="sub">
            {hasPrevious ? (
              <>
                <Change now={summary.spent} before={summary.previousSpent} /> vs {formatMonth(summary.previousMonth)}
              </>
            ) : (
              `No statements for ${formatMonth(summary.previousMonth)}`
            )}
          </div>
        </div>
        <div className="stat">
          <div className="label">{summary.income - summary.spent >= 0 ? 'Underspent' : 'Overspent'}</div>
          <div className={`value ${summary.income - summary.spent >= 0 ? 'down' : 'up'}`}>
            {formatMoney(Math.abs(summary.income - summary.spent))}
          </div>
          <div className="sub">Income minus spending</div>
        </div>
      </div>

      {partial && (
        <p className="muted small">
          Only covers {firstDay}–{lastDay} {formatMonth(month)}, from the statements imported so far.
        </p>
      )}

      {untagged && untagged.spent > 0 && (
        <p className="warning">
          {formatMoney(untagged.spent)} this month isn't tagged yet.{' '}
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
                <th className="num change-col">Change</th>
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
                <td className="change-col" />
              </tr>
              <tr className="section">
                <th colSpan={history.months.length + 2}>Spending</th>
              </tr>
              {history.rows.map((r) => {
                const [before, now] = r.amounts.slice(-2);
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
                    <td className="num change-col">{hasPrevious && <Change now={now} before={before} />}</td>
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
                <th className="num change-col">
                  {hasPrevious && <Change now={history.totals.at(-1)!} before={history.totals.at(-2)!} />}
                </th>
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
                <th className="change-col" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="muted small">
        {NOT_SPENDING.join(' and ')} aren't counted as spending. Under / over spend is income minus spending: + means you
        spent less than came in. A dash means no statements imported for that month.
      </p>
    </section>
  );
}
