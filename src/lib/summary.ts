import { categoryType, incomeTypes, spendingTypes, type BudgetData, type Transaction } from './types';

/**
 * The income categories a new budget starts with. Callers pass the user's own (every category in an
 * Income group, see incomeCategories); these are only the default.
 */
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
function spendingByCategory(transactions: Transaction[], month: string, income: string[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const t of transactions) {
    if (!t.date.startsWith(month)) continue;
    if (t.category && income.includes(t.category)) continue;
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
  /** Net money per income category (every category in an Income group), one amount per month, positive when more came in. */
  incomeRows: { category: string; amounts: number[]; ytd: number }[];
  /** Net money in all income categories per month, in pence. */
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
export function categoryHistory(transactions: Transaction[], endMonth: string, count: number, incomeCategories: string[] = NOT_SPENDING): CategoryHistory {
  const months = [endMonth];
  while (months.length < count) months.unshift(previousMonth(months[0]));
  const perMonth = months.map((m) => spendingByCategory(transactions, m, incomeCategories));

  const year = endMonth.slice(0, 4);
  const thisYear = transactions.filter((t) => t.date.startsWith(year) && t.date.slice(0, 7) <= endMonth);
  const ytdMonths = new Set(thisYear.map((t) => t.date.slice(0, 7)));
  const ytd = new Map<string, number>();
  for (const m of ytdMonths) for (const [c, v] of spendingByCategory(thisYear, m, incomeCategories)) ytd.set(c, (ytd.get(c) ?? 0) + v);

  const categories = new Set([...perMonth.flatMap((totals) => [...totals.keys()]), ...ytd.keys()]);
  const rows = [...categories]
    .map((category) => ({ category, amounts: perMonth.map((totals) => totals.get(category) ?? 0), ytd: ytd.get(category) ?? 0 }))
    // Biggest spend this year so far first, then in the latest month.
    .sort((a, b) => b.ytd - a.ytd || b.amounts[count - 1] - a.amounts[count - 1]);
  const netIn = (list: Transaction[], category: string) => sum(list.filter((t) => t.category === category).map((t) => t.amount));
  const shown = transactions.filter((t) => t.date.slice(0, 7) >= months[0] && t.date.slice(0, 7) <= endMonth);
  const incomeRows = incomeCategories
    .filter((c) => shown.some((t) => t.category === c) || thisYear.some((t) => t.category === c))
    .map((category) => ({
      category,
      amounts: months.map((m) => netIn(shown.filter((t) => t.date.startsWith(m)), category)),
      ytd: netIn(thisYear, category),
    }));
  return {
    months,
    rows,
    totals: perMonth.map((totals) => sum(totals.values())),
    incomeRows,
    income: months.map((_, i) => sum(incomeRows.map((r) => r.amounts[i]))),
    ytd: { months: ytdMonths.size, total: sum(ytd.values()), income: sum(incomeRows.map((r) => r.ytd)) },
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
  /** The type's name; null for untagged spending, which has no type yet. */
  label: string | null;
  rows: R[];
}

type GroupSettings = Pick<BudgetData, 'types' | 'categoryTypes' | 'incomeGroups'>;

/** Splits spending rows by group, in the user's order of Spending groups, each A to Z, then untagged. */
export function groupSpending<R extends { category: string }>(rows: R[], types: GroupSettings, keepEmpty = false): SpendingGroup<R>[] {
  const byName = (a: R, b: R) => a.category.localeCompare(b.category, 'en', { sensitivity: 'base' });
  const tagged = rows.filter((r) => r.category !== UNTAGGED);
  const groups: SpendingGroup<R>[] = [
    ...spendingTypes(types).map((type) => ({ label: type, rows: tagged.filter((r) => categoryType(types, r.category) === type).sort(byName) })),
    { label: null, rows: rows.filter((r) => r.category === UNTAGGED) },
  ];
  return groups.filter((g) => g.rows.length > 0 || (keepEmpty && g.label !== null));
}

/** Splits income rows by Income group, in the user's order, each A to Z. */
export function groupIncome<R extends { category: string }>(rows: R[], types: GroupSettings, keepEmpty = false): { label: string; rows: R[] }[] {
  const byName = (a: R, b: R) => a.category.localeCompare(b.category, 'en', { sensitivity: 'base' });
  return incomeTypes(types)
    .map((type) => ({ label: type, rows: rows.filter((r) => categoryType(types, r.category) === type).sort(byName) }))
    .filter((g) => g.rows.length > 0 || keepEmpty);
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

/** How many whole months the forecast covers after the month with the latest transactions. */
export const FORECAST_MONTHS = 4;

export interface Forecast {
  /** The month with the latest transactions, when it's only partly imported, then the months after it. */
  months: string[];
  /** The part month whose column is only what's left of it, after the latest transaction. */
  restOf: string | null;
  /** Net money in per income category, one amount per month, in pence. */
  incomeRows: { category: string; amounts: number[] }[];
  /** All income categories together per month, in pence. */
  income: number[];
  /** Spending per category, one amount per month, in pence. */
  rows: { category: string; amounts: number[] }[];
  totals: number[];
  /** Balance at the end of each month. Empty when the opening balance isn't known. */
  closing: number[];
}

/** The last Monday to Friday of a month: "2026-05" -> "2026-05-29". Bank holidays aren't counted. */
export function lastWorkingDayOf(month: string): string {
  const d = new Date(`${lastDayOf(month)}T12:00:00Z`);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The month with the latest transactions while it's still being filled in,
 * that is until a transaction is dated on or after its last working day.
 * Null once it's finished.
 */
export function partMonth(transactions: Transaction[]): string | null {
  const last = transactions.at(-1)?.date;
  if (!last) return null;
  return last >= lastWorkingDayOf(last.slice(0, 7)) ? null : last.slice(0, 7);
}

/**
 * The forecast from the latest transactions on: the rest of the month they
 * are in, unless it's complete, then the `FORECAST_MONTHS` after it. Each row
 * starts at its monthly average this year, rounded to whole pounds so totals
 * add up to the figures shown, unless the user typed in their own figure. For
 * the rest of a part month that's the average less what has gone so far, never
 * below zero, and the averages leave the part month out. Spending
 * `categories` with nothing spent yet get a row too, so a figure can be typed
 * in for them. Closing balances build on the actual balance after the latest
 * transaction. Categories in `unforecast` start at zero instead of their average.
 * With `wholePartMonth`, the part month is forecast as a whole month like the
 * ones after it, and its closing balance builds on the previous month's.
 */
export function forecastFrom(
  transactions: Transaction[],
  figures: Record<string, Record<string, number>> = {},
  opening: number | null,
  categories: string[] = [],
  count = FORECAST_MONTHS,
  unforecast: string[] = [],
  wholePartMonth = false,
  incomeCategories: string[] = NOT_SPENDING,
): Forecast {
  const first = monthsWithData(transactions)[0];
  const latest = monthsWithData(transactions).at(-1);
  if (!latest) return { months: [], restOf: null, incomeRows: [], income: [], rows: [], totals: [], closing: [] };
  const restOf = partMonth(transactions);
  const history = categoryHistory(transactions, restOf && first !== latest ? previousMonth(latest) : latest, 1, incomeCategories);
  const actual = categoryHistory(transactions, latest, 1, incomeCategories);
  const months: string[] = restOf ? [restOf] : [];
  for (let m = nextMonth(latest); months.length < count + (restOf ? 1 : 0); m = nextMonth(m)) months.push(m);

  const average = (amount: number) => (history.ytd.months ? Math.round(amount / history.ytd.months / 100) * 100 : 0);
  const amount = (m: string, row: string, ytd: number, soFar: number) =>
    figures[m]?.[row] ?? (m === restOf && !wholePartMonth ? Math.max(0, average(ytd) - soFar) : average(ytd));
  // Every income category gets a row, so a figure can be typed in even before any money has come in.
  const incomeRows = incomeCategories.map((category) => {
    const ytd = history.incomeRows.find((r) => r.category === category)?.ytd ?? 0;
    const soFar = actual.incomeRows.find((r) => r.category === category)?.amounts[0] ?? 0;
    const off = unforecast.includes(category);
    return { category, amounts: months.map((m) => (off ? (figures[m]?.[category] ?? 0) : amount(m, category, ytd, soFar))) };
  });
  const income = months.map((_, i) => sum(incomeRows.map((r) => r.amounts[i])));
  const spent = new Set(history.rows.map((r) => r.category));
  const rowCategories = [
    ...history.rows.map((r) => r.category),
    ...actual.rows.filter((r) => !spent.has(r.category)).map((r) => r.category),
    ...categories.filter((c) => !incomeCategories.includes(c) && !spent.has(c) && !actual.rows.some((r) => r.category === c)).sort((a, b) => a.localeCompare(b)),
  ];
  const rows = rowCategories.map((category) => {
    const ytd = history.rows.find((r) => r.category === category)?.ytd ?? 0;
    const soFar = actual.rows.find((r) => r.category === category)?.amounts[0] ?? 0;
    const off = unforecast.includes(category);
    return { category, amounts: months.map((m) => (off ? (figures[m]?.[category] ?? 0) : amount(m, category, ytd, soFar))) };
  });
  const totals = months.map((_, i) => rows.reduce((total, r) => total + r.amounts[i], 0));
  const closing: number[] = [];
  if (opening !== null) {
    const start = wholePartMonth && restOf ? `${restOf}-01` : null;
    const now = transactions.reduce((balance, t) => (start && t.date >= start ? balance : balance + t.amount), opening);
    for (let i = 0; i < months.length; i++) closing.push((closing[i - 1] ?? now) + income[i] - totals[i]);
  }
  return { months, restOf, incomeRows, income, rows, totals, closing };
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

/** Each source of money into `categories` in the six months to `endMonth`, the day it usually arrives and its part of the total. */
export function incomePaydays(transactions: Transaction[], endMonth: string, categories: string[] = ['Income']): Payday[] {
  let startMonth = endMonth;
  for (let i = 1; i < PAYDAY_MONTHS; i++) startMonth = previousMonth(startMonth);
  const sources = new Map<string, { days: number[]; total: number }>();
  for (const t of transactions) {
    const month = t.date.slice(0, 7);
    if (!t.category || !categories.includes(t.category) || t.amount <= 0 || month < startMonth || month > endMonth) continue;
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
 * The forecast balance at the end of each day from the day after `from`, the
 * last day with transactions, to `to`, starting at `balance`. Each month's
 * forecast spending is spread evenly over its days. Each income category's
 * money in arrives in one go on the days its sources usually pay; money out of
 * an income category (such as a transfer to savings), or one with no usual
 * payday, is spread evenly too. The rest of `from`'s own month spreads its
 * forecast over the days left, with income on the paydays still to come.
 */
export function dailyForecast(
  transactions: Transaction[],
  figures: Record<string, Record<string, number>> | undefined,
  from: { date: string; balance: number },
  to: string,
  categories: string[] = [],
  unforecast: string[] = [],
  incomeCategories: string[] = NOT_SPENDING,
): { date: string; balance: number }[] {
  const fromMonth = from.date.slice(0, 7);
  let count = 0;
  for (let m = nextMonth(fromMonth); m <= to.slice(0, 7); m = nextMonth(m)) count++;
  const forecast = forecastFrom(transactions, figures, null, categories, count, unforecast, false, incomeCategories);
  const index = new Map(forecast.months.map((m, i) => [m, i]));
  const fromDay = Number(from.date.slice(8));
  const daysLeft = daysInMonth(fromMonth) - fromDay;
  const sources = forecast.incomeRows.map((row) => {
    const paydays = incomePaydays(transactions, fromMonth, [row.category]);
    const received = new Set(transactions.filter((t) => t.category === row.category && t.date.startsWith(fromMonth)).map((t) => t.merchant));
    const due = paydays.filter((p) => !received.has(p.merchant) && Math.min(p.day, daysInMonth(fromMonth)) > fromDay);
    return { amounts: row.amounts, paydays, due, dueShare: due.reduce((total, p) => total + p.share, 0) };
  });

  const days: { date: string; balance: number }[] = [];
  let balance = from.balance;
  for (let day = nextDay(from.date); day <= to; day = nextDay(day)) {
    const month = day.slice(0, 7);
    const i = index.get(month);
    const length = daysInMonth(month);
    const date = Number(day.slice(8));
    const spread = month === fromMonth ? daysLeft : length;
    if (i !== undefined) {
      balance -= forecast.totals[i] / spread;
      for (const s of sources) {
        const amount = s.amounts[i];
        const paydays = month === fromMonth ? s.due : s.paydays;
        const share = month === fromMonth ? s.dueShare : s.paydays.length ? 1 : 0;
        if (amount <= 0 || share === 0) balance += amount / spread;
        else for (const p of paydays) if (Math.min(p.day, length) === date) balance += (amount * p.share) / share;
      }
    }
    days.push({ date: day, balance: Math.round(balance) });
  }
  return days;
}
