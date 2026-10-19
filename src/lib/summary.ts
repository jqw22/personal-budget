import type { Transaction } from './types';

/** Categories that move money around rather than spend it, so they're left out of spending totals. */
export const NOT_SPENDING = ['Transfers', 'Income'];

export const UNTAGGED = 'Untagged';

/** "2026-06" -> "2026-05" */
export function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** "2026-12" -> "2027-01" */
export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
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
  /** Spending per category, one amount per month, and for the calendar year so far, in pence. */
  rows: { category: string; amounts: number[]; ytd: number }[];
  /** Total spending per month, in pence. */
  totals: number[];
  /** Money tagged as Income per month, in pence. */
  income: number[];
  /** Calendar year to date, up to and including the last month shown. */
  ytd: {
    /** Months this year with any transactions, which the monthly averages divide by. */
    months: number;
    total: number;
    income: number;
  };
}

/** Spending per category for `count` months ending at `endMonth`, oldest month first, plus the year so far. */
export function categoryHistory(transactions: Transaction[], endMonth: string, count: number): CategoryHistory {
  const months = [endMonth];
  while (months.length < count) months.unshift(previousMonth(months[0]));
  const perMonth = months.map((m) => spendingByCategory(transactions, m));

  const year = endMonth.slice(0, 4);
  const thisYear = transactions.filter((t) => t.date.startsWith(year) && t.date.slice(0, 7) <= endMonth);
  const ytdMonths = new Set(thisYear.map((t) => t.date.slice(0, 7)));
  const ytd = new Map<string, number>();
  for (const m of ytdMonths) for (const [c, v] of spendingByCategory(thisYear, m)) ytd.set(c, (ytd.get(c) ?? 0) + v);

  const categories = new Set([...perMonth.flatMap((totals) => [...totals.keys()]), ...ytd.keys()]);
  const rows = [...categories]
    .map((category) => ({ category, amounts: perMonth.map((totals) => totals.get(category) ?? 0), ytd: ytd.get(category) ?? 0 }))
    // Biggest spend this year so far first, then in the latest month.
    .sort((a, b) => b.ytd - a.ytd || b.amounts[count - 1] - a.amounts[count - 1]);
  const incomeIn = (list: Transaction[]) => sum(list.filter((t) => t.category === 'Income').map((t) => t.amount));
  const income = months.map((m) => incomeIn(transactions.filter((t) => t.date.startsWith(m))));
  return {
    months,
    rows,
    totals: perMonth.map((totals) => sum(totals.values())),
    income,
    ytd: { months: ytdMonths.size, total: sum(ytd.values()), income: incomeIn(thisYear) },
  };
}

/** The balance at the end of each of `months`, adding every transaction up to then onto `opening`, in pence. */
export function closingBalances(transactions: Transaction[], opening: number, months: string[]): number[] {
  return months.map((m) => {
    const end = nextMonth(m);
    return transactions.reduce((balance, t) => (t.date < end ? balance + t.amount : balance), opening);
  });
}

export interface SpendingGroup<R> {
  /** "Essential" or "Discretionary"; null for untagged spending, which is neither yet. */
  label: string | null;
  rows: R[];
}

/** Splits spending rows into essential, then discretionary, then untagged, keeping their order within each. */
export function groupSpending<R extends { category: string }>(rows: R[], essential: string[]): SpendingGroup<R>[] {
  const groups: SpendingGroup<R>[] = [
    { label: 'Essential', rows: rows.filter((r) => essential.includes(r.category)) },
    { label: 'Discretionary', rows: rows.filter((r) => r.category !== UNTAGGED && !essential.includes(r.category)) },
    { label: null, rows: rows.filter((r) => r.category === UNTAGGED) },
  ];
  return groups.filter((g) => g.rows.length > 0);
}

/** "2026-03-01" -> "2026-03-02", in calendar days. */
export function nextDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The balance at the end of each day of `year`, from the first day there's a
 * known balance to the last transaction, in pence. Days before the first
 * transaction are left out, since the balance before then isn't known.
 */
export function dailyBalances(transactions: Transaction[], opening: number, year: string): { date: string; balance: number }[] {
  if (transactions.length === 0) return [];
  const first = transactions[0].date;
  const last = transactions[transactions.length - 1].date;
  if (first > `${year}-12-31` || last < `${year}-01-01`) return [];
  let balance = opening;
  let i = 0;
  // Everything before the year is carried in as the balance on 1 January.
  for (; i < transactions.length && transactions[i].date < `${year}-01-01`; i++) balance += transactions[i].amount;
  const days: { date: string; balance: number }[] = [];
  const end = last < `${year}-12-31` ? last : `${year}-12-31`;
  for (let day = first > `${year}-01-01` ? first : `${year}-01-01`; day <= end; day = nextDay(day)) {
    for (; i < transactions.length && transactions[i].date === day; i++) balance += transactions[i].amount;
    days.push({ date: day, balance });
  }
  return days;
}

/** How many months ahead the forecast covers. */
export const FORECAST_MONTHS = 4;

export interface Forecast {
  months: string[];
  /** Income per month, in pence. */
  income: number[];
  /** Spending per category, one amount per month, in pence. */
  rows: { category: string; amounts: number[] }[];
  totals: number[];
  /** Balance at the end of each month, from `startBalance`. Empty when that isn't known. */
  closing: number[];
}

/**
 * The months after `history`'s last month: each row's monthly average this
 * year, rounded to whole pounds so totals add up to the figures shown, unless
 * the user typed in their own figure.
 */
export function forecastAfter(
  history: CategoryHistory,
  figures: Record<string, Record<string, number>> = {},
  startBalance: number | null,
): Forecast {
  const months: string[] = [];
  for (let m = nextMonth(history.months.at(-1)!); months.length < FORECAST_MONTHS; m = nextMonth(m)) months.push(m);
  const average = (amount: number) => (history.ytd.months ? Math.round(amount / history.ytd.months / 100) * 100 : 0);
  const figure = (m: string, row: string, fallback: number) => figures[m]?.[row] ?? fallback;
  const income = months.map((m) => figure(m, 'Income', average(history.ytd.income)));
  const rows = history.rows.map((r) => ({
    category: r.category,
    amounts: months.map((m) => figure(m, r.category, average(r.ytd))),
  }));
  const totals = months.map((_, i) => rows.reduce((total, r) => total + r.amounts[i], 0));
  const closing: number[] = [];
  if (startBalance !== null) {
    for (let i = 0; i < months.length; i++) closing.push((closing[i - 1] ?? startBalance) + income[i] - totals[i]);
  }
  return { months, income, rows, totals, closing };
}
