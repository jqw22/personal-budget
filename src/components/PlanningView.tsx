import { Fragment, useMemo, useState } from 'react';
import { formatPounds } from '../lib/format';
import { groupIncome, groupSpending, monthsWithData, UNTAGGED } from '../lib/summary';
import { sortedCategories } from '../lib/store';
import { incomeCategories, type BudgetData } from '../lib/types';
import { yearTotals } from '../lib/yearTotals';
import { MoneyInput, net } from './forecastParts';

interface Props {
  data: BudgetData;
  onChange: (data: BudgetData) => void;
}

/**
 * Where the year's planned figures are typed in: two years side by side, each with Planned, Actual
 * (the summary's Total: actual months plus the forecast to December) and the difference. The
 * summary's Planned column shows the same figures.
 */
export function PlanningView({ data, onChange }: Props) {
  const allMonths = useMemo(() => monthsWithData(data.transactions), [data.transactions]);
  // The years the summary offers: each year with data plus the two after, or this year and the two after.
  const years = useMemo(() => {
    const list = [...new Set(allMonths.map((m) => m.slice(0, 4)))];
    const last = Number(list.at(-1) ?? new Date().getFullYear());
    return [...(list.length ? list : [String(last)]), String(last + 1), String(last + 2)];
  }, [allMonths]);
  // The left-hand year; the right-hand one is the year after. Starts at the latest year with data.
  const firstChoices = years.slice(0, -1);
  const [picked, setYear] = useState(() => years.at(-3)!);
  const first = firstChoices.includes(picked) ? picked : years.at(-3)!;
  const index = firstChoices.indexOf(first);
  const shown = [first, String(Number(first) + 1)];
  const totals = useMemo(() => shown.map((y) => yearTotals(data, y)), [data, first]);

  const income = incomeCategories(data);
  const archived = new Set(data.archivedCategories ?? []);
  const hasUntagged = totals.some((t) => (t.byCategory.get(UNTAGGED) ?? 0) !== 0);
  // Every category, less archived ones with nothing in either year, plus Untagged when there is some.
  const categories = sortedCategories(data.categories).filter(
    (c) => !archived.has(c) || shown.some((y, i) => (totals[i].byCategory.get(c) ?? 0) !== 0 || (data.budgets?.[y]?.[c] ?? 0) !== 0),
  );
  const rows = [...categories, ...(hasUntagged ? [UNTAGGED] : [])].map((category) => ({ category }));
  const groups = [...groupIncome(rows, data, true), ...groupSpending(rows, data, true)];

  const planned = (year: string, row: string) => data.budgets?.[year]?.[row] ?? 0;
  const actual = (i: number, row: string) => totals[i].byCategory.get(row) ?? 0;
  function setPlanned(year: string, row: string, pence: number | null) {
    const rows = { ...data.budgets?.[year] };
    if (pence === null || pence === 0) delete rows[row];
    else rows[row] = pence;
    const next = { ...data.budgets, [year]: rows };
    if (Object.keys(rows).length === 0) delete next[year];
    onChange({ ...data, budgets: next });
  }
  const sumOf = (list: { category: string }[], pick: (c: string) => number) => list.reduce((t, r) => t + pick(r.category), 0);
  const spendingRows = rows.filter((r) => !income.includes(r.category));
  const incomeRows = rows.filter((r) => income.includes(r.category));
  const plannedSpending = (y: string) => sumOf(spendingRows, (c) => (c === UNTAGGED ? 0 : planned(y, c)));
  const plannedIncome = (y: string) => sumOf(incomeRows, (c) => planned(y, c));
  const span = 1 + shown.length * 3;
  /** Three figures for one year, the first opening with a separator. */
  const trio = (key: string, a: number | string, b: number | string, c: number | string, Cell: 'td' | 'th' = 'th', netStyle = false) => (
    <Fragment key={key}>
      <Cell className="num plan-col year-start">{typeof a === 'number' ? (netStyle ? net(a) : formatPounds(a)) : a}</Cell>
      <Cell className="num">{typeof b === 'number' ? (netStyle ? net(b) : formatPounds(b)) : b}</Cell>
      <Cell className="num">{typeof c === 'number' ? (netStyle ? net(c) : formatPounds(c)) : c}</Cell>
    </Fragment>
  );

  return (
    <section className="summary-section">
      <div className="month-picker">
        <button aria-label="Previous year" disabled={index <= 0} onClick={() => setYear(firstChoices[index - 1])}>
          ‹
        </button>
        <select value={first} onChange={(e) => setYear(e.target.value)} aria-label="Years">
          {firstChoices.map((y) => (
            <option key={y} value={y}>
              {y} and {Number(y) + 1}
            </option>
          ))}
        </select>
        <button aria-label="Next year" disabled={index >= firstChoices.length - 1} onClick={() => setYear(firstChoices[index + 1])}>
          ›
        </button>
      </div>

      <h2>Planning</h2>
      <div className="table-wrap">
        <table className="summary planning">
          <thead>
            <tr>
              <th>Category</th>
              {shown.map((y) => (
                <Fragment key={y}>
                  <th className="num plan-col year-start" title={`What you plan for the whole of ${y}. Type to change it.`}>
                    {y} Planned
                  </th>
                  <th className="num" title={`The summary's Total for ${y}: actual months plus the forecast to December`}>
                    {y} Actual
                  </th>
                  <th className="num" title="Planned minus Actual">
                    Diff
                  </th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr>
                <td colSpan={span} className="muted">
                  No groups yet. Add them on the Categories tab.
                </td>
              </tr>
            )}
            {groups.map((group) => (
              <Fragment key={group.label ?? UNTAGGED}>
                {group.label && (
                  <tr className="section">
                    <th>{group.label}</th>
                    {shown.map((y) => (
                      <th key={y} colSpan={3} className="year-start" />
                    ))}
                  </tr>
                )}
                {group.rows.map(({ category }) => (
                  <tr key={category} className={category === UNTAGGED ? 'untagged' : ''}>
                    <td>{category}</td>
                    {shown.map((y, i) => (
                      <Fragment key={y}>
                        <td className="num plan-col year-start">
                          {category !== UNTAGGED && (
                            <MoneyInput
                              value={planned(y, category)}
                              edited={data.budgets?.[y]?.[category] !== undefined}
                              label={`${category} planned, ${y}`}
                              hint={`What you plan for ${category} in ${y}. Type to change it.`}
                              onCommit={(p) => setPlanned(y, category, p)}
                            />
                          )}
                        </td>
                        <td className="num muted">{formatPounds(actual(i, category))}</td>
                        <td className="num">{category === UNTAGGED ? '' : formatPounds(planned(y, category) - actual(i, category))}</td>
                      </Fragment>
                    ))}
                  </tr>
                ))}
                {group.label && group.rows.length > 0 && (
                  <tr className="subtotal">
                    <th aria-label={`${group.label} total`} />
                    {shown.map((y, i) => {
                      const p = sumOf(group.rows, (c) => planned(y, c));
                      const a = sumOf(group.rows, (c) => actual(i, c));
                      return trio(y, p, a, p - a);
                    })}
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
              {shown.map((y, i) => trio(y, plannedSpending(y), totals[i].spending, plannedSpending(y) - totals[i].spending))}
            </tr>
            <tr className="net-row">
              <th>Income - spend</th>
              {shown.map((y, i) => {
                const p = plannedIncome(y) - plannedSpending(y);
                const a = totals[i].income - totals[i].spending;
                return trio(y, p, a, p - a, 'th', true);
              })}
            </tr>
            <tr className="balance-row">
              <th>Closing balance</th>
              {shown.map((y, i) => {
                const { start, end } = totals[i];
                const p = start === null ? null : start + plannedIncome(y) - plannedSpending(y);
                return trio(y, p ?? '', end ?? '', p !== null && end !== null ? p - end : '');
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
