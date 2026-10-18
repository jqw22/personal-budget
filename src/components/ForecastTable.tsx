import { Fragment, useState } from 'react';
import { formatPounds } from '../lib/format';
import { parseMoney } from '../lib/importer';
import { groupSpending, nextMonth, type CategoryHistory } from '../lib/summary';
import type { BudgetData } from '../lib/types';

interface Props {
  data: BudgetData;
  history: CategoryHistory;
  /** The month the summary shows; the forecast covers the months after it. */
  month: string;
  /** The actual balance at the end of `month`, which forecast closing balances start from. Null when unknown. */
  startBalance: number | null;
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
  return `${amount >= 0 ? '+' : '−'}${formatPounds(Math.abs(amount))}`;
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
  const shown = text ?? String(Math.round(value / 100));

  function commit() {
    if (text === null) return;
    setText(null);
    if (text.trim() === '') return onCommit(null);
    const pence = parseMoney(text);
    if (pence !== null && pence !== value) onCommit(Math.round(Math.abs(pence) / 100) * 100);
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

export function ForecastTable({ data, history, month, startBalance, onChange }: Props) {
  const months: string[] = [];
  for (let m = nextMonth(month); months.length < MONTHS_AHEAD; m = nextMonth(m)) months.push(m);
  // Whole pounds, so the totals add up to the figures shown.
  const average = (amount: number) => (history.ytd.months ? Math.round(amount / history.ytd.months / 100) * 100 : 0);
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
  const closing: number[] = [];
  if (startBalance !== null) {
    for (let i = 0; i < months.length; i++) closing.push((closing[i - 1] ?? startBalance) + income[i] - totals[i]);
  }
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
      <td className="num ytd-col">{formatPounds(sum(amounts))}</td>
    </>
  );

  return (
    <>
      <h2>Forecast income and spend</h2>
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
            {groupSpending(rows, data.essential ?? []).map((group) => (
              <Fragment key={group.label ?? 'untagged'}>
                {group.label && (
                  <tr className="section">
                    <th colSpan={months.length + 2}>{group.label}</th>
                  </tr>
                )}
                {group.rows.map((r) => (
                  <tr key={r.category} className={group.label ? '' : 'untagged'}>
                    <td>{r.category}</td>
                    {cells(r.category, r.amounts)}
                  </tr>
                ))}
                {group.label && (
                  <tr className="subtotal">
                    <th>{group.label} total</th>
                    {months.map((m, i) => (
                      <th key={m} className="num">
                        {formatPounds(group.rows.reduce((total, r) => total + r.amounts[i], 0))}
                      </th>
                    ))}
                    <th className="num ytd-col">{formatPounds(sum(group.rows.flatMap((r) => r.amounts)))}</th>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>Total spending</th>
              {totals.map((total, i) => (
                <th key={months[i]} className="num">
                  {formatPounds(total)}
                </th>
              ))}
              <th className="num ytd-col">{formatPounds(sum(totals))}</th>
            </tr>
            <tr className="net-row">
              <th>Under / over spend</th>
              {[...totals.map((total, i) => income[i] - total), sum(income) - sum(totals)].map((amount, i) => (
                <th key={i} className={`num ${i === months.length ? 'ytd-col' : ''} ${amount >= 0 ? 'down' : 'up'}`}>
                  {net(amount)}
                </th>
              ))}
            </tr>
            {closing.length > 0 && (
              <tr className="balance-row">
                <th title="Last month's actual closing balance plus each month's forecast under / over spend">
                  Closing balance
                </th>
                {closing.map((balance, i) => (
                  <th key={months[i]} className="num">
                    {formatPounds(balance)}
                  </th>
                ))}
                <th className="ytd-col" />
              </tr>
            )}
          </tfoot>
        </table>
      </div>
    </>
  );
}
