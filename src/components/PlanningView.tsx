import { Fragment, useMemo, useState } from 'react';
import { groupIncome, groupSpending, monthsWithData } from '../lib/summary';
import { sortedCategories } from '../lib/store';
import type { BudgetData } from '../lib/types';
import { shortMonth } from './forecastParts';

interface Props {
  data: BudgetData;
}

/** "Jan 27" for January so the year reads, then just the month. */
function colMonth(m: string): string {
  const [name, year] = shortMonth(m).split(' ');
  return m.endsWith('-01') ? `${name} ${year}` : name;
}

/**
 * The year plan: the same layout as the summary (a row per category under each group, January to
 * December, Total, Average, Planned and Difference), with every figure left blank for now.
 */
export function PlanningView({ data }: Props) {
  const allMonths = useMemo(() => monthsWithData(data.transactions), [data.transactions]);
  // The years the summary offers: each year with data plus the two after, or this year and the two after.
  const years = useMemo(() => {
    const list = [...new Set(allMonths.map((m) => m.slice(0, 4)))];
    const last = Number(list.at(-1) ?? new Date().getFullYear());
    return [...(list.length ? list : [String(last)]), String(last + 1), String(last + 2)];
  }, [allMonths]);
  const [picked, setYear] = useState(() => years.at(-3)!);
  const year = years.includes(picked) ? picked : years.at(-3)!;
  const index = years.indexOf(year);
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);

  const archived = new Set(data.archivedCategories ?? []);
  const rows = sortedCategories(data.categories)
    .filter((c) => !archived.has(c))
    .map((category) => ({ category }));
  const groups = [...groupIncome(rows, data, true), ...groupSpending(rows, data, true)];
  const span = 1 + months.length + 4;
  // One blank figure cell per column after the category, with the classes that draw the separators.
  const blanks = (Cell: 'td' | 'th') => (
    <>
      {months.map((m) => (
        <Cell key={m} className="num" />
      ))}
      <Cell className="num ytd-col" />
      <Cell className="num avg-col" />
      <Cell className="num budget-col" />
      <Cell className="num diff-col" />
    </>
  );

  return (
    <section className="summary-section">
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
      </div>

      <h2>Planning</h2>
      <div className="table-wrap summary-wrap">
        <table className="summary combined planning">
          <colgroup>
            <col className="category-col" />
            {months.map((m) => (
              <col key={m} />
            ))}
            <col className="ytd-col" />
            <col className="avg-col" />
            <col className="budget-col" />
            <col className="diff-col" />
          </colgroup>
          <thead>
            <tr className="halves">
              <th />
              <th colSpan={months.length} />
              <th className="ytd-col" />
              <th className="avg-col" />
              <th className="budget-col" />
              <th className="diff-col" />
            </tr>
            <tr>
              <th>Category</th>
              {months.map((m) => (
                <th key={m} className="num">
                  {colMonth(m)}
                </th>
              ))}
              <th className="num ytd-col">Total</th>
              <th className="num avg-col">Average</th>
              <th className="num budget-col">Planned</th>
              <th className="num diff-col">Difference</th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr className="add-row">
                <td colSpan={span} className="muted">
                  No groups yet. Add them on the Categories tab.
                </td>
              </tr>
            )}
            {groups.map((group) => (
              <Fragment key={group.label}>
                <tr className="section">
                  <th>{group.label}</th>
                  <th colSpan={span - 5} />
                  <th colSpan={2} className="ytd-start" />
                  <th colSpan={2} className="budget-start" />
                </tr>
                {group.rows.map((r) => (
                  <tr key={r.category}>
                    <td>{r.category}</td>
                    {blanks('td')}
                  </tr>
                ))}
                {group.rows.length > 0 && (
                  <tr className="subtotal">
                    <th aria-label={`${group.label} total`} />
                    {blanks('th')}
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
              {blanks('th')}
            </tr>
            <tr className="net-row">
              <th>Income - spend</th>
              {blanks('th')}
            </tr>
            <tr className="balance-row">
              <th>Closing balance</th>
              {blanks('th')}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
