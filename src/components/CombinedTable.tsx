import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { formatPounds } from '../lib/format';
import { categoryHistory, closingBalances, forecastFrom, groupSpending, UNTAGGED } from '../lib/summary';
import type { BudgetData } from '../lib/types';
import { BalanceChart, type ChartColumn } from './BalanceChart';
import { MoneyInput, net, shortMonth } from './forecastParts';

interface Props {
  data: BudgetData;
  /** The last complete month the actual columns end at. Empty when there is none yet. */
  month: string;
  /** How many actual months to show. */
  count: number;
  opening: number | null;
  onShowTransactions: (month: string, category: string | null) => void;
  onChange: (data: BudgetData) => void;
  /** End-of-day balances, actual then forecast, for the chart under the table. */
  days: { date: string; balance: number }[];
  forecast: { date: string; balance: number }[];
}

const INCOME = 'Income';

/** "Jun", or "Jan 27" for January so the turn of the year reads. */
function colMonth(m: string): string {
  const [name, year] = shortMonth(m).split(' ');
  return m.endsWith('-01') ? `${name} ${year}` : name;
}

/** Actual months, their monthly average, then the forecast, in one table with a row per category. */
export function CombinedTable({ data, month, count, opening, onShowTransactions, onChange, days, forecast }: Props) {
  const table = useRef<HTMLTableElement>(null);
  const [layout, setLayout] = useState<{ columns: ChartColumn[]; width: number }>({ columns: [], width: 0 });
  // The chart's months sit exactly under the table's month columns, so measure them.
  useLayoutEffect(() => {
    const el = table.current;
    if (!el) return;
    const measure = () => {
      const box = el.getBoundingClientRect();
      const columns = [...el.querySelectorAll<HTMLElement>('thead th[data-month]')].map((th) => {
        const r = th.getBoundingClientRect();
        return { month: th.dataset.month!, left: r.left - box.left, width: r.width };
      });
      setLayout((old) =>
        old.width === box.width && JSON.stringify(old.columns) === JSON.stringify(columns) ? old : { columns, width: box.width },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  });
  const saved = data.forecast ?? {};
  const history = month ? categoryHistory(data.transactions, month, count) : null;
  const fc = forecastFrom(data.transactions, saved, opening, data.categories);
  const actualMonths = history?.months ?? [];
  const withData = new Set(data.transactions.map((t) => t.date.slice(0, 7)));
  const avgOver = history?.ytd.months ?? 0;
  const average = (amount: number) => (avgOver ? Math.round(amount / avgOver) : 0);
  const actualClosing = history && opening !== null ? closingBalances(data.transactions, opening, actualMonths) : null;

  function set(m: string, row: string, pence: number | null) {
    const rows = { ...saved[m] };
    if (pence === null) delete rows[row];
    else rows[row] = pence;
    const next = { ...saved, [m]: rows };
    if (Object.keys(rows).length === 0) delete next[m];
    onChange({ ...data, forecast: next });
  }

  // Every category in either half, in the forecast's order, then any only the actuals have (such as Untagged).
  const names = [...fc.rows.map((r) => r.category), ...(history?.rows ?? []).map((r) => r.category)];
  const rows = [...new Set(names)].map((category) => {
    const a = history?.rows.find((r) => r.category === category);
    return {
      category,
      actual: a?.amounts ?? actualMonths.map(() => 0),
      ytd: a?.ytd ?? 0,
      forecast: fc.rows.find((r) => r.category === category)?.amounts ?? null,
    };
  });
  const groups = groupSpending(rows, data.essential ?? []);
  const span = 1 + actualMonths.length + 1 + fc.months.length;
  const label = colMonth;
  const actualCell = (m: string, amount: number, Cell: 'td' | 'th' = 'td', className = '') => (
    <Cell key={m} className={`num ${className}`}>
      {withData.has(m) ? formatPounds(amount) : '–'}
    </Cell>
  );
  const totalOf = (list: typeof rows, pick: (r: (typeof rows)[number]) => number) => list.reduce((t, r) => t + pick(r), 0);

  return (
    <div className="table-wrap">
      <table className="summary combined" ref={table}>
        <colgroup>
          <col className="category-col" />
          {actualMonths.map((m) => (
            <col key={m} />
          ))}
          <col />
          {fc.months.map((m) => (
            <col key={`f${m}`} />
          ))}
        </colgroup>
        <thead>
          <tr className="halves">
            <th />
            {actualMonths.length > 0 && <th colSpan={actualMonths.length}>Actual</th>}
            <th className="avg-col" />
            <th colSpan={fc.months.length} className="fc-start">
              Forecast
            </th>
          </tr>
          <tr>
            <th>Category</th>
            {actualMonths.map((m) => (
              <th key={m} className="num" data-month={m}>
                {colMonth(m)}
              </th>
            ))}
            <th className="num avg-col" title={`${month.slice(0, 4)} so far divided by ${avgOver} month${avgOver === 1 ? '' : 's'} with data`}>
              Average
            </th>
            {fc.months.map((m, i) => (
              <th key={m} className={`num ${i === 0 ? 'fc-start' : ''}`} data-month={m}>
                {label(m)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="income-row">
            <td>
              <button className="link name" title="See Income transactions" onClick={() => onShowTransactions(month, 'Income')}>
                Income
              </button>
            </td>
            {actualMonths.map((m, i) => actualCell(m, history!.income[i]))}
            <td className="num avg-col">{formatPounds(average(history?.ytd.income ?? 0))}</td>
            {fc.months.map((m, i) => (
              <td key={`f${m}`} className={`num ${i === 0 ? 'fc-start' : ''}`}>
                <MoneyInput
                  value={fc.income[i]}
                  edited={saved[m]?.[INCOME] !== undefined}
                  label={`Income, ${label(m)}`}
                  onCommit={(p) => set(m, INCOME, p)}
                />
              </td>
            ))}
          </tr>
          {groups.map((group) => (
            <Fragment key={group.label ?? UNTAGGED}>
              {group.label && (
                <tr className="section">
                  <th>{group.label}</th>
                  <th colSpan={span - 1} />
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
                  {actualMonths.map((m, i) => actualCell(m, r.actual[i], 'td', 'muted'))}
                  <td className="num avg-col">{formatPounds(average(r.ytd))}</td>
                  {fc.months.map((m, i) => (
                    <td key={`f${m}`} className={`num ${i === 0 ? 'fc-start' : ''}`}>
                      {r.forecast && (
                        <MoneyInput
                          value={r.forecast[i]}
                          edited={saved[m]?.[r.category] !== undefined}
                          label={`${r.category}, ${label(m)}`}
                          onCommit={(p) => set(m, r.category, p)}
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              {group.label && (
                <tr className="subtotal">
                  <th>{group.label} total</th>
                  {actualMonths.map((m, i) => actualCell(m, totalOf(group.rows, (r) => r.actual[i]), 'th'))}
                  <th className="num avg-col">{formatPounds(average(totalOf(group.rows, (r) => r.ytd)))}</th>
                  {fc.months.map((m, i) => (
                    <th key={`f${m}`} className={`num ${i === 0 ? 'fc-start' : ''}`}>
                      {formatPounds(totalOf(group.rows, (r) => r.forecast?.[i] ?? 0))}
                    </th>
                  ))}
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th>Total spending</th>
            {actualMonths.map((m, i) => actualCell(m, history!.totals[i], 'th'))}
            <th className="num avg-col">{formatPounds(average(history?.ytd.total ?? 0))}</th>
            {fc.totals.map((t, i) => (
              <th key={`f${fc.months[i]}`} className={`num ${i === 0 ? 'fc-start' : ''}`}>
                {formatPounds(t)}
              </th>
            ))}
          </tr>
          <tr className="net-row">
            <th>Under / over spend</th>
            {actualMonths.map((m, i) => {
              const amount = history!.income[i] - history!.totals[i];
              return (
                <th key={m} className={`num ${!withData.has(m) ? '' : amount >= 0 ? 'down' : 'up'}`}>
                  {withData.has(m) ? net(amount) : '–'}
                </th>
              );
            })}
            {(() => {
              const amount = average(history?.ytd.income ?? 0) - average(history?.ytd.total ?? 0);
              return <th className={`num avg-col ${amount >= 0 ? 'down' : 'up'}`}>{net(amount)}</th>;
            })()}
            {fc.totals.map((t, i) => {
              const amount = fc.income[i] - t;
              return (
                <th key={`f${fc.months[i]}`} className={`num ${i === 0 ? 'fc-start' : ''} ${amount >= 0 ? 'down' : 'up'}`}>
                  {net(amount)}
                </th>
              );
            })}
          </tr>
          {opening !== null && (
            <tr className="balance-row">
              <th>Closing balance</th>
              {actualMonths.map((m, i) => actualCell(m, actualClosing![i], 'th'))}
              <th className="avg-col" />
              {fc.closing.map((b, i) => (
                <th key={`f${fc.months[i]}`} className={`num ${i === 0 ? 'fc-start' : ''}`}>
                  {formatPounds(b)}
                </th>
              ))}
            </tr>
          )}
        </tfoot>
      </table>
      {opening !== null && <BalanceChart columns={layout.columns} width={layout.width} days={days} forecast={forecast} />}
    </div>
  );
}
