import { useState } from 'react';
import { formatMoney } from '../lib/format';
import { parseMoney } from '../lib/importer';
import { nextMonth, type CategoryHistory } from '../lib/summary';
import type { BudgetData } from '../lib/types';

interface Props {
  data: BudgetData;
  history: CategoryHistory;
  /** The month the summary shows; the forecast covers the months after it. */
  month: string;
  onChange: (data: BudgetData) => void;
}

/** How many months ahead the forecast covers. */
const MONTHS_AHEAD = 4;
/** Forecast key for the income row; every other row is a spending category. */
const INCOME = 'Income';

function shortMonth(month: string): string {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
}

function net(amount: number): string {
  return `${amount >= 0 ? '+' : '−'}${formatMoney(Math.abs(amount))}`;
}

/** A money box that saves when you leave it. Clearing it goes back to the average. */
function MoneyInput({
  value,
  edited,
  label,
  onCommit,
}: {
  value: number;
  edited: boolean;
  label: string;
  onCommit: (pence: number | null) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (value / 100).toFixed(2);

  function commit() {
    if (text === null) return;
    setText(null);
    if (text.trim() === '') return onCommit(null);
    const pence = parseMoney(text);
    if (pence !== null && pence !== value) onCommit(Math.abs(pence));
  }

  return (
    <input
      className={`forecast-input ${edited ? 'edited' : ''}`}
      inputMode="decimal"
      aria-label={label}
      title={edited ? 'Your figure. Clear it to go back to the monthly average.' : 'Monthly average. Type to change it.'}
      value={shown}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(null);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function ForecastTable({ data, history, month, onChange }: Props) {
  const months: string[] = [];
  for (let m = nextMonth(month); months.length < MONTHS_AHEAD; m = nextMonth(m)) months.push(m);
  const average = (amount: number) => (history.ytd.months ? Math.round(amount / history.ytd.months) : 0);
  const forecast = data.forecast ?? {};
  const figure = (m: string, row: string, fallback: number) => forecast[m]?.[row] ?? fallback;

  function set(m: string, row: string, pence: number | null) {
    const rows = { ...forecast[m] };
    if (pence === null) delete rows[row];
    else rows[row] = pence;
    const next = { ...forecast, [m]: rows };
    if (Object.keys(rows).length === 0) delete next[m];
    onChange({ ...data, forecast: next });
  }

  const income = months.map((m) => figure(m, INCOME, average(history.ytd.income)));
  const rows = history.rows.map((r) => ({
    category: r.category,
    amounts: months.map((m) => figure(m, r.category, average(r.ytd))),
  }));
  const totals = months.map((_, i) => rows.reduce((total, r) => total + r.amounts[i], 0));
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const edited = months.some((m) => Object.keys(forecast[m] ?? {}).length > 0);

  const cells = (row: string, amounts: number[]) => (
    <>
      {amounts.map((amount, i) => (
        <td key={months[i]} className="num">
          <MoneyInput
            value={amount}
            edited={forecast[months[i]]?.[row] !== undefined}
            label={`${row}, ${shortMonth(months[i])}`}
            onCommit={(pence) => set(months[i], row, pence)}
          />
        </td>
      ))}
      <td className="num ytd-col">{formatMoney(sum(amounts))}</td>
    </>
  );

  return (
    <>
      <h2>Forecast</h2>
      <p className="muted small">
        Starts from each row's monthly average. Type over any figure to change it, or clear a box to go back to the
        average.{edited && ' Figures you have typed in are shown in green.'}
      </p>
      <div className="table-wrap">
        <table className="summary forecast">
          <thead>
            <tr>
              <th>Category</th>
              {months.map((m) => (
                <th key={m} className="num">
                  {shortMonth(m)}
                </th>
              ))}
              <th className="num ytd-col">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr className="income-row">
              <td>Income</td>
              {cells(INCOME, income)}
            </tr>
            <tr className="section">
              <th colSpan={months.length + 2}>Spending</th>
            </tr>
            {rows.map((r) => (
              <tr key={r.category}>
                <td>{r.category}</td>
                {cells(r.category, r.amounts)}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>Total spending</th>
              {totals.map((total, i) => (
                <th key={months[i]} className="num">
                  {formatMoney(total)}
                </th>
              ))}
              <th className="num ytd-col">{formatMoney(sum(totals))}</th>
            </tr>
            <tr className="net-row">
              <th>Under / over spend</th>
              {[...totals.map((total, i) => income[i] - total), sum(income) - sum(totals)].map((amount, i) => (
                <th key={i} className={`num ${i === months.length ? 'ytd-col' : ''} ${amount >= 0 ? 'down' : 'up'}`}>
                  {net(amount)}
                </th>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}
