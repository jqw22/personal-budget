import type { Transaction } from './types';

/** Categories that move money around rather than spend it, so they're left out of spending totals. */
export const NOT_SPENDING = ['Transfers', 'Income'];

export const UNTAGGED = 'Untagged';

/** "2026-06" -> "2026-05" */
export function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function monthsWithData(transactions: Transaction[]): string[] {
  return [...new Set(transactions.map((t) => t.date.slice(0, 7)))].sort();
}

/**
 * Spending per category for one month, in pence. Untagged money coming in is
 * left out, since it's usually income or a transfer rather than a refund.
 */
function spendingByCategory(transactions: Transaction[], month: string): Map<string, number> {
  const totals = new Map<string, number>();
  for (const t of transactions) {
    if (!t.date.startsWith(month)) continue;
    if (t.category && NOT_SPENDING.includes(t.category)) continue;
    if (!t.category && t.amount > 0) continue;
    const key = t.category ?? UNTAGGED;
    totals.set(key, (totals.get(key) ?? 0) - t.amount);
  }
  return totals;
}

function sum(values: Iterable<number>): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

export interface CategoryHistory {
  /** The months covered, oldest first. */
  months: string[];
  /** Spending per category, one amount per month, in pence. */
  rows: { category: string; amounts: number[] }[];
  /** Total spending per month, in pence. */
  totals: number[];
  /** Money tagged as Income per month, in pence. */
  income: number[];
}

/** Spending per category for `count` months ending at `endMonth`, oldest month first. */
export function categoryHistory(transactions: Transaction[], endMonth: string, count: number): CategoryHistory {
  const months = [endMonth];
  while (months.length < count) months.unshift(previousMonth(months[0]));
  const perMonth = months.map((m) => spendingByCategory(transactions, m));
  const categories = new Set(perMonth.flatMap((totals) => [...totals.keys()]));
  const rows = [...categories]
    .map((category) => ({ category, amounts: perMonth.map((totals) => totals.get(category) ?? 0) }))
    // Biggest spend in the latest month first, then across the whole period.
    .sort((a, b) => b.amounts[count - 1] - a.amounts[count - 1] || sum(b.amounts) - sum(a.amounts));
  const income = months.map((m) =>
    sum(transactions.filter((t) => t.date.startsWith(m) && t.category === 'Income').map((t) => t.amount)),
  );
  return { months, rows, totals: perMonth.map((totals) => sum(totals.values())), income };
}
