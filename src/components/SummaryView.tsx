import { Fragment, useMemo, useState } from 'react';
import { formatMoney, formatMonth, formatPounds } from '../lib/format';
import {
  categoryHistory,
  closingBalances,
  dailyBalances,
  dailyForecast,
  FORECAST_MONTHS,
  groupSpending,
  lastDayOf,
  monthsWithData,
  nextMonth,
  previousMonth,
  UNTAGGED,
} from '../lib/summary';
import { impliedOpeningBalance } from '../lib/export';
import { BalanceChart } from './BalanceChart';
import type { BudgetData } from '../lib/types';
import { ForecastTable } from './ForecastTable';

interface Props {
  data: BudgetData;
  /** Opens the transactions for a month and category; null means untagged. */
  onShowTransactions: (month: string, category: string | null) => void;
  onChange: (data: BudgetData) => void;
}

/** How many months the category table shows, ending at the chosen month. */
const MONTHS_SHOWN = 4;
/** How many months of actual balances the chart shows, ending at the latest. */
const CHART_MONTHS_BACK = 12;

/** Signed money for the under / over spend line. */
function net(amount: number): string {
  return `${amount >= 0 ? '+' : '−'}${formatPounds(Math.abs(amount))}`;
}

function shortMonth(month: string): string {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short' });
}

export function SummaryView({ data, onShowTransactions, onChange }: Props) {
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
  const average = (amount: number) => (history?.ytd.months ? Math.round(amount / history.ytd.months) : 0);
  const opening = data.openingBalance ?? impliedOpeningBalance(data.transactions);
  const closing = history && opening !== null ? closingBalances(data.transactions, opening, history.months) : null;
  // The latest 12 months with data and the forecast's months after them, whichever month the tables show.
  const latest = months[months.length - 1];
  const chartMonths = [latest];
  while (chartMonths.length < CHART_MONTHS_BACK) chartMonths.unshift(previousMonth(chartMonths[0]));
  while (chartMonths.length < CHART_MONTHS_BACK + FORECAST_MONTHS) chartMonths.push(nextMonth(chartMonths[chartMonths.length - 1]));
  const chartEnd = lastDayOf(chartMonths[chartMonths.length - 1]);
  const days = opening === null ? [] : dailyBalances(data.transactions, opening, `${chartMonths[0]}-01`, chartEnd);
  const lastActual = days.at(-1);
  const forecast = lastActual ? dailyForecast(data.transactions, data.forecast, lastActual, chartEnd, data.categories) : [];
  const yearCells = (amount: number, header = false) => {
    const Cell = header ? 'th' : 'td';
    return (
      <>
        <Cell className="num ytd-col">{formatPounds(amount)}</Cell>
        <Cell className="num">{formatPounds(average(amount))}</Cell>
      </>
    );
  };

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

      <h2>Actual income and spend</h2>
      {!history || history.rows.length === 0 ? (
        <p className="muted">No spending in these months.</p>
      ) : (
        <div className="table-wrap">
          <table className="summary">
            <colgroup>
              <col className="category-col" />
              {[...history.months, 'ytd', 'avg'].map((key) => (
                <col key={key} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th>Category</th>
                {history.months.map((m) => (
                  <th key={m} className="num">
                    {shortMonth(m)}
                  </th>
                ))}
                <th className="num ytd-col" title={`January to ${formatMonth(month)}`}>
                  {month.slice(0, 4)} so far
                </th>
                <th className="num" title={`Year so far divided by ${history.ytd.months} month${history.ytd.months === 1 ? '' : 's'} with data`}>
                  Monthly avg
                </th>
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
                    {withData.has(history.months[i]) ? formatPounds(amount) : '–'}
                  </td>
                ))}
                {yearCells(history.ytd.income)}
              </tr>
              {groupSpending(history.rows, data.essential ?? []).map((group) => (
                <Fragment key={group.label ?? UNTAGGED}>
                  {group.label && (
                    <tr className="section">
                      <th colSpan={history.months.length + 3}>{group.label}</th>
                    </tr>
                  )}
                  {group.rows.map((r) => (
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
                          {withData.has(history.months[i]) ? formatPounds(amount) : '–'}
                        </td>
                      ))}
                      {yearCells(r.ytd)}
                    </tr>
                  ))}
                  {group.label && (
                    <tr className="subtotal">
                      <th>{group.label} total</th>
                      {history.months.map((m, i) => (
                        <th key={m} className="num">
                          {withData.has(m) ? formatPounds(group.rows.reduce((total, r) => total + r.amounts[i], 0)) : '–'}
                        </th>
                      ))}
                      {yearCells(group.rows.reduce((total, r) => total + r.ytd, 0), true)}
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>Total spending</th>
                {history.totals.map((total, i) => (
                  <th key={history.months[i]} className="num">
                    {withData.has(history.months[i]) ? formatPounds(total) : '–'}
                  </th>
                ))}
                {yearCells(history.ytd.total, true)}
              </tr>
              <tr className="net-row">
                <th>Under / over spend</th>
                {history.totals.map((total, i) => {
                  const amount = history.income[i] - total;
                  return (
                    <th key={history.months[i]} className={`num ${!withData.has(history.months[i]) ? '' : amount >= 0 ? 'down' : 'up'}`}>
                      {withData.has(history.months[i]) ? net(amount) : '–'}
                    </th>
                  );
                })}
                {[history.ytd.income - history.ytd.total, average(history.ytd.income) - average(history.ytd.total)].map(
                  (amount, i) => (
                    <th key={i} className={`num ${i === 0 ? 'ytd-col' : ''} ${amount >= 0 ? 'down' : 'up'}`}>
                      {net(amount)}
                    </th>
                  ),
                )}
              </tr>
              {closing && (
                <tr className="balance-row">
                  <th title="Opening balance plus every transaction to the end of the month">Closing balance</th>
                  {closing.map((balance, i) => (
                    <th key={history.months[i]} className="num">
                      {withData.has(history.months[i]) ? formatPounds(balance) : '–'}
                    </th>
                  ))}
                  <th className="ytd-col" />
                  <th />
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      )}

      {history && history.rows.length > 0 && <ForecastTable data={data} opening={opening} onChange={onChange} />}

      {opening !== null && <BalanceChart months={chartMonths} days={days} forecast={forecast} />}
    </section>
  );
}
