import { useMemo, useState } from 'react';
import { formatMoney, formatMonth } from '../lib/format';
import { monthsWithData, NOT_SPENDING, spendingByMonth, summarise, UNTAGGED } from '../lib/summary';
import type { BudgetData } from '../lib/types';

interface Props {
  data: BudgetData;
  onShowUntagged: (month: string) => void;
}

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

export function SummaryView({ data, onShowUntagged }: Props) {
  const months = useMemo(() => monthsWithData(data.transactions), [data.transactions]);
  const [month, setMonth] = useState(() => months.at(-1) ?? '');
  const summary = useMemo(() => summarise(data.transactions, month), [data.transactions, month]);
  const history = useMemo(() => spendingByMonth(data.transactions).slice(-12), [data.transactions]);

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
  const maxLine = Math.max(1, ...summary.lines.map((l) => l.spent));
  const maxMonth = Math.max(1, ...history.map((h) => h.spent));
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
          <div className="label">Income</div>
          <div className="value">{formatMoney(summary.income)}</div>
          <div className="sub">Tagged as Income</div>
        </div>
        <div className="stat">
          <div className="label">Last month</div>
          <div className="value">{hasPrevious ? formatMoney(summary.previousSpent) : '–'}</div>
          <div className="sub">Spent in {formatMonth(summary.previousMonth)}</div>
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
          <button className="link inline-link" onClick={() => onShowUntagged(month)}>
            Tag it now
          </button>
        </p>
      )}

      <h2>Spending by category</h2>
      {summary.lines.length === 0 ? (
        <p className="muted">No spending this month.</p>
      ) : (
        <div className="table-wrap">
          <table className="summary">
            <thead>
              <tr>
                <th>Category</th>
                <th className="bar-col" aria-hidden />
                <th className="num">{shortMonth(month)}</th>
                <th className="num">{shortMonth(summary.previousMonth)}</th>
                <th className="num">Change</th>
              </tr>
            </thead>
            <tbody>
              {summary.lines.map((l) => (
                <tr key={l.category} className={l.category === UNTAGGED ? 'untagged' : ''}>
                  <td>{l.category}</td>
                  <td className="bar-col">
                    {l.spent > 0 && (
                      <div
                        className="bar"
                        style={{ width: `${(l.spent / maxLine) * 100}%` }}
                        title={`${l.category}: ${formatMoney(l.spent)}`}
                      />
                    )}
                  </td>
                  <td className="num">{formatMoney(l.spent)}</td>
                  <td className="num muted">{hasPrevious ? formatMoney(l.previous) : '–'}</td>
                  <td className="num">{hasPrevious && <Change now={l.spent} before={l.previous} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">{NOT_SPENDING.join(' and ')} aren't counted as spending.</p>

      {history.length > 1 && (
        <>
          <h2>Spending by month</h2>
          <div className="month-chart" role="list">
            {history.map((h) => (
              <button
                key={h.month}
                role="listitem"
                className={`month-bar ${h.month === month ? 'selected' : ''}`}
                title={`${formatMonth(h.month)}: ${formatMoney(h.spent)}`}
                onClick={() => setMonth(h.month)}
              >
                <span className="column">
                  <span className="amount">{formatMoney(h.spent).replace(/\.\d\d$/, '')}</span>
                  <span className="fill" style={{ height: `${(Math.max(0, h.spent) / maxMonth) * 85}%` }} />
                </span>
                <span className="label">{shortMonth(h.month)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
