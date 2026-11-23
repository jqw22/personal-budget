import { useMemo, useState } from 'react';
import { formatMoney, formatMonth } from '../lib/format';
import {
  categoryHistory,
  dailyBalances,
  dailyForecast,
  monthsWithData,
  partMonth,
  UNTAGGED,
} from '../lib/summary';
import { impliedOpeningBalance } from '../lib/export';
import { unforecastCategories, type BudgetData } from '../lib/types';
import { CombinedTable } from './CombinedTable';
import { expandSplits } from '../lib/splits';

interface Props {
  data: BudgetData;
  /** Opens the transactions for a month and category; null means untagged. */
  onShowTransactions: (month: string, category: string | null) => void;
  onChange: (data: BudgetData) => void;
}

/** The width a portrait A4 page leaves for the table, in CSS pixels, inside the 8mm print margins. */
const PRINT_WIDTH = 725;

/** Prints the summary scaled down, if it needs to be, so the whole year fits one page across. */
function printSummary() {
  const table = document.querySelector<HTMLElement>('table.summary.combined');
  const zoom = table ? Math.min(1, PRINT_WIDTH / table.scrollWidth) : 1;
  document.documentElement.style.setProperty('--print-zoom', String(zoom));
  window.print();
}

/** Months from January of `month`'s year up to and including it. */
function monthsIntoYear(month: string): number {
  return Number(month.slice(5, 7));
}

export function SummaryView({ data, onShowTransactions, onChange }: Props) {
  // Split transactions count as their parts, each in its own category.
  const transactions = useMemo(() => expandSplits(data.transactions), [data.transactions]);
  const allMonths = useMemo(() => monthsWithData(transactions), [transactions]);
  // A month still being filled in is only in the forecast, as a whole month.
  const part = useMemo(() => partMonth(transactions), [transactions]);
  const months = useMemo(() => allMonths.filter((m) => m !== part), [allMonths, part]);
  // Every year with data, plus the one after the latest so its budget can be set ahead.
  const years = useMemo(() => {
    const list = [...new Set(allMonths.map((m) => m.slice(0, 4)))];
    return list.length ? [...list, String(Number(list.at(-1)) + 1)] : list;
  }, [allMonths]);
  const [picked, setYear] = useState(() => years.at(-2) ?? '');
  const year = years.includes(picked) ? picked : (years.at(-2) ?? '');
  // The table runs January to December of the picked year: complete months as actuals, then the
  // forecast up to the end of the year, which only the latest year has.
  const month = months.filter((m) => m.startsWith(year)).at(-1) ?? '';
  const history = useMemo(() => (month ? categoryHistory(transactions, month, monthsIntoYear(month)) : null), [transactions, month]);

  if (allMonths.length === 0) {
    return (
      <section>
        <h2>Summary</h2>
        <p className="muted">No transactions yet. Import a CSV to get started.</p>
      </section>
    );
  }

  const index = years.indexOf(year);
  const latest = allMonths[allMonths.length - 1];
  const isLatestYear = latest.startsWith(year);
  const isNextYear = year > latest.slice(0, 4);
  // Whole months after the latest one with data, up to December of the picked year; the part month
  // comes on top. Next year is all forecast, carrying on from the rest of this one.
  const forecastCount = isLatestYear ? 12 - monthsIntoYear(latest) : isNextYear ? 24 - monthsIntoYear(latest) : null;
  const untaggedSpent = history?.rows.find((r) => r.category === UNTAGGED)?.amounts.at(-1) ?? 0;
  const firstMonth = allMonths.find((m) => m.startsWith(year)) ?? '';
  const firstTransactions = transactions.filter((t) => t.date.startsWith(firstMonth));
  const firstDay = Number(firstTransactions[0]?.date.slice(8));
  const lastDay = Number(firstTransactions.at(-1)?.date.slice(8));
  // A finished month can end on its last working day, so only a late start makes it partial.
  const partial = firstMonth !== part && firstTransactions.length > 0 && firstDay > 1;
  const opening = impliedOpeningBalance(transactions);
  // The chart runs under the table's columns: January (or the first month with data) to December.
  const chartStart = firstMonth;
  const chartEnd = `${year}-12-31`;
  const days = opening === null ? [] : dailyBalances(transactions, opening, `${chartStart}-01`, chartEnd);
  const lastActual = days.at(-1);
  const forecast =
    lastActual && isLatestYear
      ? dailyForecast(transactions, data.forecast, lastActual, chartEnd, data.categories, unforecastCategories(data, data.categories))
      : [];

  return (
    <section className="summary-section">
      {years.length > 0 && (
        <div className="month-picker">
          <button aria-label="Previous year" disabled={index <= 0} onClick={() => setYear(years[index - 1])}>
            ‹
          </button>
          <select value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year">
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <button aria-label="Next year" disabled={index >= years.length - 1} onClick={() => setYear(years[index + 1])}>
            ›
          </button>
          <button className="print-button" onClick={printSummary}>
            Print
          </button>
        </div>
      )}

      {partial && (
        <p className="muted small">
          Only covers {firstDay}–{lastDay} {formatMonth(firstMonth)}, from the statements imported so far.
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

      <h2>
        Income and spend <span className="print-only">{year}</span>
      </h2>
      <CombinedTable
        data={data}
        year={year}
        month={month}
        count={month ? monthsIntoYear(month) : 0}
        forecastCount={forecastCount}
        opening={opening}
        onShowTransactions={onShowTransactions}
        onChange={onChange}
        days={days}
        forecast={forecast}
      />

    </section>
  );
}
