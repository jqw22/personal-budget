import type { Transaction } from './types';

/** Categories that move money around rather than spend it, so they're left out of spending totals. */
export const NOT_SPENDING = ['Transfers', 'Income'];

export const UNTAGGED = 'Untagged';

export interface CategoryLine {
  category: string;
  /** Spent this month, in pence. Refunds tagged to the category reduce it. */
  spent: number;
  /** Spent in the month before, in pence. */
  previous: number;
}

export interface MonthSummary {
  month: string;
  previousMonth: string;
  spent: number;
  previousSpent: number;
  income: number;
  lines: CategoryLine[];
}

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

export function summarise(transactions: Transaction[], month: string): MonthSummary {
  const prev = previousMonth(month);
  const current = spendingByCategory(transactions, month);
  const before = spendingByCategory(transactions, prev);

  const lines = [...new Set([...current.keys(), ...before.keys()])]
    .map((category) => ({ category, spent: current.get(category) ?? 0, previous: before.get(category) ?? 0 }))
    .sort((a, b) => b.spent - a.spent || b.previous - a.previous);

  const income = sum(
    transactions.filter((t) => t.date.startsWith(month) && t.category === 'Income').map((t) => t.amount),
  );

  return {
    month,
    previousMonth: prev,
    spent: sum(current.values()),
    previousSpent: sum(before.values()),
    income,
    lines,
  };
}

/** Total spending for each month that has data, oldest first. */
export function spendingByMonth(transactions: Transaction[]): { month: string; spent: number }[] {
  return monthsWithData(transactions).map((month) => ({
    month,
    spent: sum(spendingByCategory(transactions, month).values()),
  }));
}
