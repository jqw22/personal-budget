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
 * The balance at the end of each day from `start` to `end` (inclusive dates),
 * up to the last transaction, in pence. Days before the first transaction are
 * left out, since the balance before then isn't known.
 */
export function dailyBalances(transactions: Transaction[], opening: number, start: string, end: string): { date: string; balance: number }[] {
  if (transactions.length === 0) return [];
  const first = transactions[0].date;
  const last = transactions[transactions.length - 1].date;
  if (first > end || last < start) return [];
  let balance = opening;
  let i = 0;
  // Everything before the range is carried in as the balance on its first day.
  for (; i < transactions.length && transactions[i].date < start; i++) balance += transactions[i].amount;
  const days: { date: string; balance: number }[] = [];
  const stop = last < end ? last : end;
  for (let day = first > start ? first : start; day <= stop; day = nextDay(day)) {
    for (; i < transactions.length && transactions[i].date === day; i++) balance += transactions[i].amount;
    days.push({ date: day, balance });
  }
  return days;
}

/** The last day of a month: "2026-02" -> "2026-02-28". */
export function lastDayOf(month: string): string {
  return `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
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
 * the user typed in their own figure. Spending `categories` with nothing spent
 * yet get a row too, so a figure can be typed in for them.
 */
export function forecastAfter(
  history: CategoryHistory,
  figures: Record<string, Record<string, number>> = {},
  startBalance: number | null,
  count = FORECAST_MONTHS,
  categories: string[] = [],
): Forecast {
  const months: string[] = [];
  for (let m = nextMonth(history.months.at(-1)!); months.length < count; m = nextMonth(m)) months.push(m);
  const average = (amount: number) => (history.ytd.months ? Math.round(amount / history.ytd.months / 100) * 100 : 0);
  const figure = (m: string, row: string, fallback: number) => figures[m]?.[row] ?? fallback;
  const income = months.map((m) => figure(m, 'Income', average(history.ytd.income)));
  const empty = categories
    .filter((c) => !NOT_SPENDING.includes(c) && !history.rows.some((r) => r.category === c))
    .sort((a, b) => a.localeCompare(b))
    .map((category) => ({ category, ytd: 0 }));
  const rows = [...history.rows, ...empty].map((r) => ({
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

function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** How many months back the usual payday of each income is worked out from. */
const PAYDAY_MONTHS = 6;

export interface Payday {
  /** Who pays it, from the transaction's merchant. */
  merchant: string;
  /** The day of the month it usually arrives. */
  day: number;
  /** Its part of all income, from 0 to 1. */
  share: number;
}

/** Each source of Income in the six months to `endMonth`, the day it usually arrives and its part of the total. */
export function incomePaydays(transactions: Transaction[], endMonth: string): Payday[] {
  let startMonth = endMonth;
  for (let i = 1; i < PAYDAY_MONTHS; i++) startMonth = previousMonth(startMonth);
  const sources = new Map<string, { days: number[]; total: number }>();
  for (const t of transactions) {
    const month = t.date.slice(0, 7);
    if (t.category !== 'Income' || t.amount <= 0 || month < startMonth || month > endMonth) continue;
    const source = sources.get(t.merchant) ?? { days: [], total: 0 };
    source.days.push(Number(t.date.slice(8)));
    source.total += t.amount;
    sources.set(t.merchant, source);
  }
  const all = sum([...sources.values()].map((s) => s.total));
  return [...sources].map(([merchant, s]) => ({
    merchant,
    day: [...s.days].sort((a, b) => a - b)[Math.floor(s.days.length / 2)],
    share: s.total / all,
  }));
}

/**
 * The forecast balance at the end of each day from the day after `from` to
 * `to`, starting at `balance`. Each month's forecast spending is spread evenly
 * over its days, and its income arrives in one go on the day each source
 * usually pays. The rest of `from`'s own month, which is only partly imported,
 * spends at the monthly average and gets any income not yet received.
 */
export function dailyForecast(
  transactions: Transaction[],
  history: CategoryHistory,
  figures: Record<string, Record<string, number>> | undefined,
  from: { date: string; balance: number },
  to: string,
  categories: string[] = [],
): { date: string; balance: number }[] {
  const toMonth = to.slice(0, 7);
  const fromMonth = from.date.slice(0, 7);
  let count = 0;
  for (let m = history.months.at(-1)!; m < toMonth; m = nextMonth(m)) count++;
  const forecast = forecastAfter(history, figures, null, count, categories);
  const spending = new Map(forecast.months.map((m, i) => [m, forecast.totals[i]]));
  const income = new Map(forecast.months.map((m, i) => [m, forecast.income[i]]));
  // Rounded to whole pounds like the forecast table's averages.
  const average = (amount: number) => (history.ytd.months ? Math.round(amount / history.ytd.months / 100) * 100 : 0);
  const averageSpending = history.rows.reduce((total, r) => total + average(r.ytd), 0);
  const paydays = incomePaydays(transactions, fromMonth);
  const received = new Set(transactions.filter((t) => t.category === 'Income' && t.date.startsWith(fromMonth)).map((t) => t.merchant));

  const days: { date: string; balance: number }[] = [];
  let balance = from.balance;
  for (let day = nextDay(from.date); day <= to; day = nextDay(day)) {
    const month = day.slice(0, 7);
    const length = daysInMonth(month);
    const monthIncome = income.get(month) ?? average(history.ytd.income);
    balance -= (spending.get(month) ?? averageSpending) / length;
    if (paydays.length === 0) balance += monthIncome / length;
    for (const p of paydays) {
      if (Math.min(p.day, length) !== Number(day.slice(8))) continue;
      if (month === fromMonth && received.has(p.merchant)) continue;
      balance += monthIncome * p.share;
    }
    days.push({ date: day, balance: Math.round(balance) });
  }
  return days;
}
