import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { formatPounds } from '../lib/format';
import { categoryHistory, closingBalances, forecastFrom, groupIncome, groupSpending, UNTAGGED } from '../lib/summary';
import { incomeCategories, typeList, type BudgetData } from '../lib/types';
import { addCategory, categoryUse, removeCategory, setArchived } from '../lib/store';
import { BalanceChart, type ChartColumn } from './BalanceChart';
import { MoneyInput, net, shortMonth } from './forecastParts';
import { inYear } from '../lib/yearTotals';
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

/** "Jun", or "Jan 27" for January so the turn of the year reads. */
function colMonth(m: string): string {
  const [name, year] = shortMonth(m).split(' ');
  return m.endsWith('-01') ? `${name} ${year}` : name;
}

/** The year's budget, the actual months and the forecast, then this year so far and its monthly average, in one table with a row per category. */
export function CombinedTable({ data, year, month, count, forecastCount, opening, onShowTransactions, onChange, days, forecast }: Props) {
  const table = useRef<HTMLTableElement>(null);
  /** The group a category is being added to, and the name typed so far. */
  const [adding, setAdding] = useState<{ group: string; name: string } | null>(null);
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
  const income = incomeCategories(data);
  const history = month ? categoryHistory(transactions, month, count, income) : null;
  const fc = inYear(
    forecastCount === null
      ? { months: [], restOf: null, incomeRows: [], income: [], rows: [], totals: [], closing: [] }
      : forecastFrom(transactions, saved, opening, data.categories, forecastCount, data.categories, true, income),
    year,
  );
  const actualMonths = history?.months ?? [];
  const withData = new Set(transactions.map((t) => t.date.slice(0, 7)));
  // YTD is the whole year: actual months plus the forecast to December. Average spreads it over 12.
  const sum = (list: number[]) => list.reduce((t, n) => t + n, 0);
  const ytd = {
    income: sum(history?.income ?? []) + sum(fc.income),
    total: sum(history?.totals ?? []) + sum(fc.totals),
  };
  const average = (amount: number) => Math.round(amount / 12);
  const actualClosing = history && opening !== null ? closingBalances(transactions, opening, actualMonths) : null;
  // The balance going into January: from the bank's balances for a year with data, or from the
  // forecast for next year, which has none yet.
  const yearStart =
    opening === null
      ? null
      : actualMonths.length || !fc.months.length
        ? opening + sum(data.transactions.filter((t) => t.date < `${year}-01-01`).map((t) => t.amount))
        : fc.closing[0] - (fc.income[0] - fc.totals[0]);
  const yearEnd = fc.closing.at(-1) ?? actualClosing?.at(-1) ?? null;

  const budgets = data.budgets?.[year] ?? {};
  const budget = (row: string) => budgets[row] ?? 0;
  // Planned figures are typed in on the Planning tab; here they're shown as they are.
  const budgetCell = (row: string) => (
    <td className="num budget-col" title={`Planned for ${row} in ${year}. Change it on the Planning tab.`}>
      {formatPounds(budget(row))}
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
  type Row = { category: string; actual: number[]; ytd: number; forecast: number[] | null };
  const rowsOf = (
    actual: { category: string; amounts: number[] }[] | undefined,
    forecastRows: { category: string; amounts: number[] }[],
    others: string[],
  ): Row[] =>
    [...new Set([...forecastRows.map((r) => r.category), ...(actual ?? []).map((r) => r.category), ...others])].map((category) => {
      const a = actual?.find((r) => r.category === category);
      const f = forecastRows.find((r) => r.category === category);
      return {
        category,
        actual: a?.amounts ?? actualMonths.map(() => 0),
        ytd: sum(a?.amounts ?? []) + sum(f?.amounts ?? []),
        forecast: f?.amounts ?? null,
      };
    });
  // Every category gets a row, so one just added shows at once; an archived one only while it has figures.
  const archived = new Set(data.archivedCategories ?? []);
  const shown = (r: Row) =>
    !archived.has(r.category) || r.ytd !== 0 || budget(r.category) !== 0 || r.actual.some((n) => n !== 0) || (r.forecast ?? []).some((n) => n !== 0);
  const rows = rowsOf(history?.rows, fc.rows, data.categories.filter((c) => !income.includes(c))).filter(shown);
  const incomeRows = rowsOf(history?.incomeRows, fc.incomeRows, income).filter(shown);
  const groups = groupSpending(rows, data, true);
  const incomeGroups = groupIncome(incomeRows, data, true);
  const totalOf = (list: Row[], pick: (r: Row) => number) => list.reduce((t, r) => t + pick(r), 0);
  const budgetSpending = totalOf(rows, (r) => (r.category === UNTAGGED ? 0 : budget(r.category)));
  const budgetIncome = totalOf(incomeRows, (r) => budget(r.category));
  const budgetClosing = (start: number) => start + budgetIncome - budgetSpending;
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

  /** Removes a category, after asking when transactions or rules use it. */
  function remove(category: string) {
    const use = categoryUse(data, category);
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const used = [use.transactions && plural(use.transactions, 'transaction'), use.rules && plural(use.rules, 'merchant rule')].filter(Boolean);
    if (used.length && !window.confirm(`${category} is used by ${used.join(' and ')}. Remove it? Its transactions go back to untagged and its rules are deleted. To keep them, archive it instead.`)) return;
    if (!used.length && !window.confirm(`Remove ${category}?`)) return;
    onChange(removeCategory(data, category));
  }

  /** A group's heading, its categories and its total. */
  const renderGroup = (group: { label: string | null; rows: Row[] }) => (
    <Fragment key={group.label ?? UNTAGGED}>
      {group.label && (
        <tr className="section">
          <th>
            {group.label}
            <button
              className="link row-add"
              title={`Add a category to ${group.label}`}
              aria-label={`Add a category to ${group.label}`}
              onClick={() => setAdding({ group: group.label!, name: '' })}
            >
              +
            </button>
          </th>
          {/* Split where the separator columns fall, so they run unbroken through the headings. */}
          <th colSpan={span - 5} />
          <th colSpan={2} className="ytd-start" />
          <th colSpan={2} className="budget-start" />
        </tr>
      )}
      {group.rows.map((r) => (
        <tr key={r.category} className={r.category === UNTAGGED ? 'untagged' : ''}>
          <td className="category-cell">
            <button
              className="link name"
              title={`See ${r.category} transactions`}
              onClick={() => onShowTransactions(month, r.category === UNTAGGED ? null : r.category)}
            >
              {r.category}
            </button>
            {r.category !== UNTAGGED && (
              <span className="row-tools">
                <button
                  className="link"
                  title={
                    archived.has(r.category)
                      ? `Bring ${r.category} back`
                      : `Archive ${r.category}: keep it and its transactions, but hide it from tagging lists, and from the summary in years it has nothing`
                  }
                  onClick={() => onChange(setArchived(data, r.category, !archived.has(r.category)))}
                >
                  {archived.has(r.category) ? 'Unarchive' : 'Archive'}
                </button>
                <button className="link" title={`Remove ${r.category}`} aria-label={`Remove ${r.category}`} onClick={() => remove(r.category)}>
                  ×
                </button>
              </span>
            )}
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
      {group.label && adding?.group === group.label && (
        <tr className="add-row">
          <td colSpan={span}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const name = adding.name.trim();
                if (name && !data.categories.includes(name)) onChange(addCategory(data, name, group.label!));
                setAdding(null);
              }}
            >
              <input
                autoFocus
                aria-label={`New category in ${group.label}`}
                placeholder={`New category in ${group.label}`}
                value={adding.name}
                onChange={(e) => setAdding({ group: group.label!, name: e.target.value })}
                onKeyDown={(e) => e.key === 'Escape' && setAdding(null)}
              />
              <button type="submit" disabled={!adding.name.trim() || data.categories.includes(adding.name.trim())}>
                Add
              </button>
              <button type="button" onClick={() => setAdding(null)}>
                Cancel
              </button>
              {data.categories.includes(adding.name.trim()) && <span className="muted">That category already exists.</span>}
            </form>
          </td>
        </tr>
      )}
      {group.label && group.rows.length > 0 && (
        <tr className="subtotal">
          {/* The heading above names the group, so its total row needs no label. */}
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
            <th className="num budget-col" title={`What you plan for the whole of ${year}`}>
              Planned
            </th>
            <th className="num diff-col" title="Planned minus Total">
              Difference
            </th>
          </tr>
        </thead>
        <tbody>
          {typeList(data).length === 0 && (
            <tr className="add-row">
              <td colSpan={span} className="muted">
                No groups yet. Add them on the Categories tab, then add categories to them here.
              </td>
            </tr>
          )}
          {incomeGroups.map((group) => renderGroup(group))}
          {incomeGroups.length > 1 && (
            <tr className="subtotal income-total">
              <th>Total income</th>
              {actualMonths.map((m, i) => actualCell(m, history!.income[i], 'th'))}
              {fc.months.map((m, i) => (
                <th key={`f${m}`} className={`num fc ${i === 0 ? 'fc-start' : ''}`}>
                  {formatPounds(fc.income[i])}
                </th>
              ))}
              <th className="num ytd-col">{formatPounds(ytd.income)}</th>
              <th className="num avg-col">{formatPounds(average(ytd.income))}</th>
              <th className="num budget-col">{formatPounds(budgetIncome)}</th>
              <th className="num diff-col">{formatPounds(budgetIncome - ytd.income)}</th>
            </tr>
          )}
          {groups.map((group) => renderGroup(group))}
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
              const amount = ytd.income - ytd.total;
              return <th className={`num ytd-col ${amount >= 0 ? 'down' : 'up'}`}>{net(amount)}</th>;
            })()}
            {(() => {
              const amount = average(ytd.income) - average(ytd.total);
              return <th className={`num avg-col ${amount >= 0 ? 'down' : 'up'}`}>{net(amount)}</th>;
            })()}
            {(() => {
              const amount = budgetIncome - budgetSpending;
              return <th className={`num budget-col ${amount >= 0 ? 'down' : 'up'}`}>{net(amount)}</th>;
            })()}
            {(() => {
              const amount = budgetIncome - budgetSpending - (ytd.income - ytd.total);
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
              {/* The year's total column shows where December ends up. */}
              <th className="num ytd-col">{yearEnd !== null && formatPounds(yearEnd)}</th>
              <th className="avg-col" />
              <th className="num budget-col" title="Balance going into January, plus planned income, less planned spending">
                {yearStart !== null && formatPounds(budgetClosing(yearStart))}
              </th>
              <th className="num diff-col">{yearStart !== null && yearEnd !== null && formatPounds(budgetClosing(yearStart) - yearEnd)}</th>
            </tr>
          )}
        </tfoot>
      </table>
      {opening !== null && <BalanceChart columns={layout.columns} width={layout.width} days={days} forecast={forecast} />}
    </div>
  );
}
