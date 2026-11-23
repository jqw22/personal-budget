import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { formatPounds } from '../lib/format';
import { categoryHistory, closingBalances, forecastFrom, groupSpending, UNTAGGED } from '../lib/summary';
import { unforecastCategories, type BudgetData } from '../lib/types';
import { BalanceChart, type ChartColumn } from './BalanceChart';
import { MoneyInput, net, shortMonth } from './forecastParts';
import { expandSplits } from '../lib/splits';

interface Props {
  data: BudgetData;
  /** The calendar year shown, such as "2026": the budget column is this year's. */
  year: string;
  /** The last complete month the actual columns end at. Empty when there is none yet. */
  month: string;
  /** How many actual months to show. */
  count: number;
  /** How many whole months to forecast after the latest with data (the part month comes on top), or null for none. */
  forecastCount: number | null;
  opening: number | null;
  onShowTransactions: (month: string, category: string | null) => void;
  onChange: (data: BudgetData) => void;
  /** End-of-day balances, actual then forecast, for the chart under the table. */
  days: { date: string; balance: number }[];
  forecast: { date: string; balance: number }[];
}

const INCOME = 'Income';
const TRANSFERS = 'Transfers';

/** "Jun", or "Jan 27" for January so the turn of the year reads. */
function colMonth(m: string): string {
  const [name, year] = shortMonth(m).split(' ');
  return m.endsWith('-01') ? `${name} ${year}` : name;
}

/** Just the forecast months in `year`: next year's forecast is worked out from the rest of this one, then trimmed. */
function inYear(fc: ReturnType<typeof forecastFrom>, year: string): ReturnType<typeof forecastFrom> {
  const from = fc.months.findIndex((m) => m.startsWith(year));
  if (from <= 0) return fc;
  return {
    ...fc,
    months: fc.months.slice(from),
    income: fc.income.slice(from),
    transfers: fc.transfers.slice(from),
    rows: fc.rows.map((r) => ({ ...r, amounts: r.amounts.slice(from) })),
    totals: fc.totals.slice(from),
    closing: fc.closing.slice(from),
  };
}

/** The year's budget, the actual months and the forecast, then this year so far and its monthly average, in one table with a row per category. */
export function CombinedTable({ data, year, month, count, forecastCount, opening, onShowTransactions, onChange, days, forecast }: Props) {
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
  // Split transactions count as their parts; `data` itself is only ever saved back unchanged.
  const transactions = expandSplits(data.transactions);
  const history = month ? categoryHistory(transactions, month, count) : null;
  const fc = inYear(
    forecastCount === null
      ? { months: [], restOf: null, income: [], transfers: [], rows: [], totals: [], closing: [] }
      : forecastFrom(transactions, saved, opening, data.categories, forecastCount, unforecastCategories(data, data.categories), true),
    year,
  );
  const actualMonths = history?.months ?? [];
  const withData = new Set(transactions.map((t) => t.date.slice(0, 7)));
  // YTD is the whole year: actual months plus the forecast to December. Average spreads it over 12.
  const sum = (list: number[]) => list.reduce((t, n) => t + n, 0);
  const ytd = {
    income: sum(history?.income ?? []) + sum(fc.income),
    transfers: sum(history?.transfers ?? []) + sum(fc.transfers),
    total: sum(history?.totals ?? []) + sum(fc.totals),
  };
  const average = (amount: number) => Math.round(amount / 12);
  const actualClosing = history && opening !== null ? closingBalances(transactions, opening, actualMonths) : null;

  const budgets = data.budgets?.[year] ?? {};
  const budget = (row: string) => budgets[row] ?? 0;
  function setBudget(row: string, pence: number | null) {
    const rows = { ...budgets };
    if (pence === null || pence === 0) delete rows[row];
    else rows[row] = pence;
    const next = { ...data.budgets, [year]: rows };
    if (Object.keys(rows).length === 0) delete next[year];
    onChange({ ...data, budgets: next });
  }
  const budgetCell = (row: string) => (
    <td className="num budget-col">
      <MoneyInput
        value={budget(row)}
        edited={budgets[row] !== undefined}
        label={`${row} budget, ${year}`}
        hint={`Your budget for ${row} in ${year}. Type to change it.`}
        onCommit={(p) => setBudget(row, p)}
      />
    </td>
  );

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
      ytd: sum(a?.amounts ?? []) + sum(fc.rows.find((r) => r.category === category)?.amounts ?? []),
      forecast: fc.rows.find((r) => r.category === category)?.amounts ?? null,
    };
  });
  const groups = groupSpending(rows, data);
  const totalOf = (list: typeof rows, pick: (r: (typeof rows)[number]) => number) => list.reduce((t, r) => t + pick(r), 0);
  const budgetSpending = totalOf(rows, (r) => (r.category === UNTAGGED ? 0 : budget(r.category)));
  const span = 1 + 2 + 2 + actualMonths.length + fc.months.length;
  const label = colMonth;
  /** A figure for a month; given a row to open, clicking it shows the transactions behind it. */
  const actualCell = (m: string, amount: number, Cell: 'td' | 'th' = 'td', className = '', open?: string) => (
    <Cell key={m} className={`num ${className}`}>
      {!withData.has(m) ? (
        '–'
      ) : open && amount !== 0 ? (
        <button
          className="link figure"
          title={`See ${open === UNTAGGED ? 'untagged' : open} transactions in ${shortMonth(m)}`}
          onClick={() => onShowTransactions(m, open === UNTAGGED ? null : open)}
        >
          {formatPounds(amount)}
        </button>
      ) : (
        formatPounds(amount)
      )}
    </Cell>
  );

  return (
    <div className="table-wrap summary-wrap">
      <table className="summary combined" ref={table}>
        <colgroup>
          <col className="category-col" />
          {actualMonths.map((m) => (
            <col key={m} />
          ))}
          {fc.months.map((m) => (
            <col key={`f${m}`} />
          ))}
          <col className="ytd-col" />
          <col className="avg-col" />
          <col className="budget-col" />
          <col className="diff-col" />
        </colgroup>
        <thead>
          <tr className="halves">
            <th />
            {actualMonths.length > 0 && <th colSpan={actualMonths.length}>Actual</th>}
            {fc.months.length > 0 && (
              <th colSpan={fc.months.length} className="fc fc-start">
                Forecast
              </th>
            )}
            <th className="ytd-col" />
            <th className="avg-col" />
            <th className="budget-col" />
            <th className="diff-col" />
          </tr>
          <tr>
            <th>Category</th>
            {actualMonths.map((m) => (
              <th key={m} className="num" data-month={m}>
                {colMonth(m)}
              </th>
            ))}
            {fc.months.map((m, i) => (
              <th key={m} className={`num fc ${i === 0 ? 'fc-start' : ''}`} data-month={m}>
                {label(m)}
              </th>
            ))}
            <th className="num ytd-col" title={`The whole of ${year}: actual months plus the forecast`}>
              Total
            </th>
            <th className="num avg-col" title={`Total divided by 12`}>
              Average
            </th>
            <th className="num budget-col" title={`Your budget for the whole of ${year}`}>
              Budget
            </th>
            <th className="num diff-col" title="Budget minus Total">
              Difference
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="income-row">
            <td>
              <button className="link name" title="See Income transactions" onClick={() => onShowTransactions(month, 'Income')}>
                Income
              </button>
            </td>
            {actualMonths.map((m, i) => actualCell(m, history!.income[i], 'td', '', 'Income'))}
            {fc.months.map((m, i) => (
              <td key={`f${m}`} className={`num fc ${i === 0 ? 'fc-start' : ''}`}>
                <MoneyInput
                  value={fc.income[i]}
                  edited={saved[m]?.[INCOME] !== undefined}
                  label={`Income, ${label(m)}`}
                  onCommit={(p) => set(m, INCOME, p)}
                />
              </td>
            ))}
            <td className="num ytd-col">{formatPounds(ytd.income)}</td>
            <td className="num avg-col">{formatPounds(average(ytd.income))}</td>
            {budgetCell(INCOME)}
            <td className="num diff-col">{formatPounds(budget(INCOME) - ytd.income)}</td>
          </tr>
          {/* Moves the balance but isn't income or spending, so it's left out of the under / over spend. */}
          <tr className="transfers-row">
            <td>
              <button className="link name" title="See Transfers transactions" onClick={() => onShowTransactions(month, 'Transfers')}>
                Transfers
              </button>
            </td>
            {actualMonths.map((m, i) => actualCell(m, history!.transfers[i], 'td', 'muted', 'Transfers'))}
            {fc.months.map((m, i) => (
              <td key={`f${m}`} className={`num fc ${i === 0 ? 'fc-start' : ''}`}>
                <MoneyInput
                  value={fc.transfers[i]}
                  edited={saved[m]?.[TRANSFERS] !== undefined}
                  label={`Transfers, ${label(m)}`}
                  onCommit={(p) => set(m, TRANSFERS, p)}
                />
              </td>
            ))}
            <td className="num ytd-col">{formatPounds(ytd.transfers)}</td>
            <td className="num avg-col">{formatPounds(average(ytd.transfers))}</td>
            {budgetCell(TRANSFERS)}
            <td className="num diff-col">{formatPounds(budget(TRANSFERS) - ytd.transfers)}</td>
          </tr>
          <tr className="subtotal income-total">
            <th>Total income</th>
            {actualMonths.map((m, i) => actualCell(m, history!.income[i] + history!.transfers[i], 'th'))}
            {fc.months.map((m, i) => (
              <th key={`f${m}`} className={`num fc ${i === 0 ? 'fc-start' : ''}`}>
                {formatPounds(fc.income[i] + fc.transfers[i])}
              </th>
            ))}
            <th className="num ytd-col">{formatPounds(ytd.income + ytd.transfers)}</th>
            <th className="num avg-col">{formatPounds(average(ytd.income + ytd.transfers))}</th>
            <th className="num budget-col">{formatPounds(budget(INCOME) + budget(TRANSFERS))}</th>
            <th className="num diff-col">{formatPounds(budget(INCOME) + budget(TRANSFERS) - ytd.income - ytd.transfers)}</th>
          </tr>
          {groups.map((group) => (
            <Fragment key={group.label ?? UNTAGGED}>
              {group.label && (
                <tr className="section">
                  <th>{group.label}</th>
                  {/* Split where the separator columns fall, so they run unbroken through the headings. */}
                  <th colSpan={span - 5} />
                  <th colSpan={2} className="ytd-start" />
                  <th colSpan={2} className="budget-start" />
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
                  {actualMonths.map((m, i) => actualCell(m, r.actual[i], 'td', 'muted', r.category))}
                  {fc.months.map((m, i) => (
                    <td key={`f${m}`} className={`num fc ${i === 0 ? 'fc-start' : ''}`}>
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
                  <td className="num ytd-col">{formatPounds(r.ytd)}</td>
                  <td className="num avg-col">{formatPounds(average(r.ytd))}</td>
                  {r.category === UNTAGGED ? <td className="num budget-col" /> : budgetCell(r.category)}
                  {r.category === UNTAGGED ? <td className="num diff-col" /> : <td className="num diff-col">{formatPounds(budget(r.category) - r.ytd)}</td>}
                </tr>
              ))}
              {group.label && (
                <tr className="subtotal">
                  {/* The heading above names the type, so its total row needs no label. */}
                  <th aria-label={`${group.label} total`} />
                  {actualMonths.map((m, i) => actualCell(m, totalOf(group.rows, (r) => r.actual[i]), 'th'))}
                  {fc.months.map((m, i) => (
                    <th key={`f${m}`} className={`num fc ${i === 0 ? 'fc-start' : ''}`}>
                      {formatPounds(totalOf(group.rows, (r) => r.forecast?.[i] ?? 0))}
                    </th>
                  ))}
                  <th className="num ytd-col">{formatPounds(totalOf(group.rows, (r) => r.ytd))}</th>
                  <th className="num avg-col">{formatPounds(average(totalOf(group.rows, (r) => r.ytd)))}</th>
                  <th className="num budget-col">{formatPounds(totalOf(group.rows, (r) => budget(r.category)))}</th>
                  <th className="num diff-col">{formatPounds(totalOf(group.rows, (r) => budget(r.category) - r.ytd))}</th>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr className="gap-row" aria-hidden="true">
            <td colSpan={span} />
          </tr>
          <tr>
            <th>Total spending</th>
            {actualMonths.map((m, i) => actualCell(m, history!.totals[i], 'th'))}
            {fc.totals.map((t, i) => (
              <th key={`f${fc.months[i]}`} className={`num fc ${i === 0 ? 'fc-start' : ''}`}>
                {formatPounds(t)}
              </th>
            ))}
            <th className="num ytd-col">{formatPounds(ytd.total)}</th>
            <th className="num avg-col">{formatPounds(average(ytd.total))}</th>
            <th className="num budget-col">{formatPounds(budgetSpending)}</th>
            <th className="num diff-col">{formatPounds(budgetSpending - ytd.total)}</th>
          </tr>
          <tr className="net-row">
            <th>Income - spend</th>
            {actualMonths.map((m, i) => {
              const amount = history!.income[i] - history!.totals[i];
              return (
                <th key={m} className={`num ${!withData.has(m) ? '' : amount >= 0 ? 'down' : 'up'}`}>
                  {withData.has(m) ? net(amount) : '–'}
                </th>
              );
            })}
            {fc.totals.map((t, i) => {
              const amount = fc.income[i] - t;
              return (
                <th key={`f${fc.months[i]}`} className={`num fc ${i === 0 ? 'fc-start' : ''} ${amount >= 0 ? 'down' : 'up'}`}>
                  {net(amount)}
                </th>
              );
            })}
            {(() => {
              const amount = (ytd.income) - (ytd.total);
              return <th className={`num ytd-col ${amount >= 0 ? 'down' : 'up'}`}>{net(amount)}</th>;
            })()}
            {(() => {
              const amount = average(ytd.income) - average(ytd.total);
              return <th className={`num avg-col ${amount >= 0 ? 'down' : 'up'}`}>{net(amount)}</th>;
            })()}
            {(() => {
              const amount = budget(INCOME) - budgetSpending;
              return <th className={`num budget-col ${amount >= 0 ? 'down' : 'up'}`}>{net(amount)}</th>;
            })()}
            {(() => {
              const amount = budget(INCOME) - budgetSpending - (ytd.income - ytd.total);
              return <th className={`num diff-col ${amount >= 0 ? 'down' : 'up'}`}>{net(amount)}</th>;
            })()}
          </tr>
          {opening !== null && (
            <tr className="balance-row">
              <th>Closing balance</th>
              {actualMonths.map((m, i) => actualCell(m, actualClosing![i], 'th'))}
              {fc.closing.map((b, i) => (
                <th key={`f${fc.months[i]}`} className={`num fc ${i === 0 ? 'fc-start' : ''}`}>
                  {formatPounds(b)}
                </th>
              ))}
              <th className="ytd-col" />
              <th className="avg-col" />
              <th className="budget-col" />
              <th className="diff-col" />
            </tr>
          )}
        </tfoot>
      </table>
      {opening !== null && <BalanceChart columns={layout.columns} width={layout.width} days={days} forecast={forecast} />}
    </div>
  );
}
