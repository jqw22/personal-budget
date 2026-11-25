import { impliedOpeningBalance } from './export';
import { expandSplits } from './splits';
import { categoryHistory, forecastFrom, monthsWithData, partMonth, type Forecast } from './summary';
import { incomeCategories, type BudgetData } from './types';

/** Months from January of `month`'s year up to and including it. */
export function monthsIntoYear(month: string): number {
  return Number(month.slice(5, 7));
}

/** Just the forecast months in `year`: next year's forecast is worked out from the rest of this one, then trimmed. */
export function inYear(fc: Forecast, year: string): Forecast {
  const from = fc.months.findIndex((m) => m.startsWith(year));
  if (from <= 0) return fc;
  return {
    ...fc,
    months: fc.months.slice(from),
    incomeRows: fc.incomeRows.map((r) => ({ ...r, amounts: r.amounts.slice(from) })),
    income: fc.income.slice(from),
    rows: fc.rows.map((r) => ({ ...r, amounts: r.amounts.slice(from) })),
    totals: fc.totals.slice(from),
    closing: fc.closing.slice(from),
  };
}

export interface YearTotals {
  /** Each category's whole year, actual months plus the forecast to December, in pence (Untagged included). */
  byCategory: Map<string, number>;
  /** All income categories together. */
  income: number;
  /** All spending, untagged included. */
  spending: number;
  /** The balance going into January, when it can be worked out. */
  start: number | null;
  /** The balance at the end of December, actual or forecast. */
  end: number | null;
}

/**
 * A year's figures as the summary's Total column shows them: complete months as actuals, then the
 * forecast to December (only the latest year with data, and the years after it, have one). A year
 * before any data has none.
 */
export function yearTotals(data: BudgetData, year: string): YearTotals {
  const transactions = expandSplits(data.transactions);
  const allMonths = monthsWithData(transactions);
  const part = partMonth(transactions);
  const months = allMonths.filter((m) => m !== part);
  const latest = allMonths.at(-1);
  const income = incomeCategories(data);
  const opening = impliedOpeningBalance(transactions);
  const empty: Forecast = { months: [], restOf: null, incomeRows: [], income: [], rows: [], totals: [], closing: [] };
  if (!latest) return { byCategory: new Map(), income: 0, spending: 0, start: null, end: null };

  const month = months.filter((m) => m.startsWith(year)).at(-1) ?? '';
  const history = month ? categoryHistory(transactions, month, monthsIntoYear(month), income) : null;
  const yearsAhead = Number(year) - Number(latest.slice(0, 4));
  const forecastCount = yearsAhead >= 0 ? 12 * (yearsAhead + 1) - monthsIntoYear(latest) : null;
  const fc = inYear(
    forecastCount === null ? empty : forecastFrom(transactions, data.forecast ?? {}, opening, data.categories, forecastCount, data.categories, true, income),
    year,
  );
  const sum = (list: number[]) => list.reduce((t, n) => t + n, 0);
  const byCategory = new Map<string, number>();
  const add = (category: string, amounts: number[]) => byCategory.set(category, (byCategory.get(category) ?? 0) + sum(amounts));
  for (const r of [...(history?.rows ?? []), ...(history?.incomeRows ?? []), ...fc.rows, ...fc.incomeRows]) add(r.category, r.amounts);

  const actualMonths = history?.months ?? [];
  const start =
    opening === null
      ? null
      : actualMonths.length || !fc.months.length
        ? opening + sum(transactions.filter((t) => t.date < `${year}-01-01`).map((t) => t.amount))
        : fc.closing[0] - (fc.income[0] - fc.totals[0]);
  const actualEnd = opening === null || !month ? null : opening + sum(transactions.filter((t) => t.date.slice(0, 7) <= month).map((t) => t.amount));
  return {
    byCategory,
    income: sum(history?.income ?? []) + sum(fc.income),
    spending: sum(history?.totals ?? []) + sum(fc.totals),
    start,
    end: fc.closing.at(-1) ?? actualEnd,
  };
}
