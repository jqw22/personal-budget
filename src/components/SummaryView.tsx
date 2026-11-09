import { useMemo, useState } from 'react';
import { formatMoney, formatMonth } from '../lib/format';
import {
  categoryHistory,
  dailyBalances,
  dailyForecast,
  FORECAST_MONTHS,
  lastDayOf,
  monthsWithData,
  partMonth,
  nextMonth,
  previousMonth,
  UNTAGGED,
} from '../lib/summary';
import { impliedOpeningBalance } from '../lib/export';
import type { BudgetData } from '../lib/types';
import { CombinedTable } from './CombinedTable';
import { expandSplits } from '../lib/splits';

interface Props {
  data: BudgetData;
  /** Opens the transactions for a month and category; null means untagged. */
  onShowTransactions: (month: string, category: string | null) => void;
  onChange: (data: BudgetData) => void;
}

/** How many months the category table shows, ending at the chosen month. */
const MONTHS_SHOWN = 4;

export function SummaryView({ data, onShowTransactions, onChange }: Props) {
  // Split transactions count as their parts, each in its own category.
  const transactions = useMemo(() => expandSplits(data.transactions), [data.transactions]);
  const allMonths = useMemo(() => monthsWithData(transactions), [transactions]);
  // A month still being filled in is only in the forecast, as the rest of it.
  const part = useMemo(() => partMonth(transactions), [transactions]);
  const months = useMemo(() => allMonths.filter((m) => m !== part), [allMonths, part]);
  const [picked, setMonth] = useState(() => months.at(-1) ?? '');
  // The picked month, or the latest complete one if that has gone (e.g. it is now the part month).
  const month = months.includes(picked) ? picked : (months.at(-1) ?? '');
  const history = useMemo(() => (month ? categoryHistory(transactions, month, MONTHS_SHOWN) : null), [
    transactions,
    month,
  ]);

  if (allMonths.length === 0) {
    return (
      <section>
        <h2>Summary</h2>
        <p className="muted">No transactions yet. Import a CSV to get started.</p>
      </section>
    );
  }

  const index = months.indexOf(month);
  const untaggedSpent = history?.rows.find((r) => r.category === UNTAGGED)?.amounts.at(-1) ?? 0;
  const monthTransactions = transactions.filter((t) => t.date.startsWith(month));
  const firstDay = Number(monthTransactions[0]?.date.slice(8));
  const lastDay = Number(monthTransactions.at(-1)?.date.slice(8));
  // A finished month can end on its last working day, so only a late start makes it partial.
  const partial = monthTransactions.length > 0 && firstDay > 1;
  const opening = impliedOpeningBalance(transactions);
  // The latest 12 months with data and the forecast's months after them, whichever month the tables show.
  const latest = allMonths[allMonths.length - 1];
  // The chart runs from the first actual column to the end of the forecast, under the table's columns.
  let chartStart = month || latest;
  for (let i = 1; month && i < MONTHS_SHOWN; i++) chartStart = previousMonth(chartStart);
  let chartLast = latest;
  for (let i = 0; i < FORECAST_MONTHS; i++) chartLast = nextMonth(chartLast);
  const chartEnd = lastDayOf(chartLast);
  const days = opening === null ? [] : dailyBalances(transactions, opening, `${chartStart}-01`, chartEnd);
  const lastActual = days.at(-1);
  const forecast = lastActual ? dailyForecast(transactions, data.forecast, lastActual, chartEnd, data.categories) : [];

  return (
    <section>
      {months.length > 0 && (
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
      )}

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

      <h2>Income and spend</h2>
      <p className="muted small">
        Actual: complete months only, to {month ? formatMonth(month) : 'none yet'}
        {part ? `; ${formatMonth(part)} isn't complete until a transaction is dated on or after its last working day, so it is the first forecast month and covers what is still to come` : ''}.
        Average: calendar year to date, January to {months.length ? formatMonth(months[months.length - 1]) : 'now'}, per month with data. Forecast: each figure starts from the monthly average; type
        over one to change it, or clear it to go back. Closing balances build on your actual balance now.
      </p>
      <CombinedTable
        data={data}
        month={month}
        count={MONTHS_SHOWN}
        averageTo={months.at(-1) ?? ''}
        opening={opening}
        onShowTransactions={onShowTransactions}
        onChange={onChange}
        days={days}
        forecast={forecast}
      />

    </section>
  );
}
