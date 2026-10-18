import { parseCsv } from './csv';
import { merchantName } from './merchant';
import type { Transaction } from './types';

/** Which CSV column holds each field; -1 means the file has no such column. */
export interface ColumnMapping {
  date: number;
  description: number;
  /** Money in (credit) column, for banks that split in and out. */
  moneyIn: number;
  /** Money out (debit) column, for banks that split in and out. */
  moneyOut: number;
  /** Single signed amount column, for banks that use one. */
  amount: number;
  balance: number;
  /** This app's own id, in files it downloaded, so importing one again skips what's already saved. */
  id: number;
}

export interface ImportResult {
  transactions: Transaction[];
  /** Rows that were skipped, with the reason, for showing to the user. */
  skipped: { row: number; reason: string }[];
  /** Rows whose running balance doesn't match the previous balance plus the amount. */
  balanceMismatches: number[];
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function findColumn(headers: string[], names: string[]): number {
  const norm = headers.map((h) => h.trim().toLowerCase());
  for (const name of names) {
    const i = norm.indexOf(name);
    if (i !== -1) return i;
  }
  return -1;
}

export function guessMapping(headers: string[]): ColumnMapping {
  return {
    date: findColumn(headers, ['date', 'transaction date', 'posting date', 'posted date']),
    description: findColumn(headers, ['description', 'details', 'narrative', 'transaction description', 'memo', 'payee']),
    moneyIn: findColumn(headers, ['in', 'money in', 'paid in', 'credit', 'credit amount']),
    moneyOut: findColumn(headers, ['out', 'money out', 'paid out', 'debit', 'debit amount']),
    amount: findColumn(headers, ['amount', 'value']),
    balance: findColumn(headers, ['balance', 'running balance']),
    id: findColumn(headers, ['id']),
  };
}

/** Parses "2,658.43", "£10.00", "-5.90" or "(5.90)" into pence. Blank gives null. */
export function parseMoney(value: string | undefined): number | null {
  if (value === undefined) return null;
  let s = value.trim().replace(/[£$€,\s]/g, '');
  if (s === '') return null;
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const pence = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return negative ? -pence : pence;
}

interface PartialDate {
  day: number;
  month: number; // 1-12
  year: number | null;
}

/** Parses "21-May", "21 May 2026", "21/05/2026", "21/05/26" or "2026-05-21". */
export function parseDate(value: string): PartialDate | null {
  const s = value.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };

  m = s.match(/^(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*(?:[-\s/](\d{2,4}))?$/);
  if (m) {
    const month = MONTHS.indexOf(m[2].toLowerCase()) + 1;
    if (month === 0) return null;
    return { day: Number(m[1]), month, year: m[3] ? fullYear(m[3]) : null };
  }

  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) return { day: Number(m[1]), month: Number(m[2]), year: fullYear(m[3]) };

  return null;
}

function fullYear(y: string): number {
  const n = Number(y);
  return y.length === 2 ? 2000 + n : n;
}

/** Year of the "ON dd-mm-yyyy" card date that many UK banks put in the description. */
function yearHint(description: string, postedMonth: number): number | null {
  const m = description.match(/\bON (\d{2})-(\d{2})-(\d{4})\b/);
  if (!m) return null;
  const year = Number(m[3]);
  // A card used on 31 Dec can post on 2 Jan.
  return Number(m[2]) === 12 && postedMonth === 1 ? year + 1 : year;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Small, fast string hash (FNV-1a) for building duplicate-detection ids. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function readCsv(text: string): { headers: string[]; rows: string[][] } {
  const [headers = [], ...rows] = parseCsv(text);
  return { headers: headers.map((h) => h.trim()), rows };
}

/**
 * Turns CSV rows into transactions. Dates without a year (e.g. "21-May") get
 * their year from the card date in the description, from neighbouring rows,
 * or from `fallbackYear`, rolling over to the next year when months wrap.
 */
export function importRows(rows: string[][], mapping: ColumnMapping, fallbackYear: number): ImportResult {
  const skipped: ImportResult['skipped'] = [];
  const parsed: { row: number; date: PartialDate; description: string; amount: number; balance: number | null; id: string }[] = [];

  rows.forEach((cells, i) => {
    const row = i + 2; // 1-based, after the header row
    const description = (cells[mapping.description] ?? '').replace(/\s+/g, ' ').trim();
    const date = parseDate(cells[mapping.date] ?? '');
    if (!date) {
      skipped.push({ row, reason: `Couldn't read the date "${cells[mapping.date] ?? ''}"` });
      return;
    }
    if (/^balance (brought|carried) forward/i.test(description)) {
      skipped.push({ row, reason: 'Balance line, not a transaction' });
      return;
    }

    let amount: number | null;
    if (mapping.amount !== -1) {
      amount = parseMoney(cells[mapping.amount]);
    } else {
      const moneyIn = parseMoney(cells[mapping.moneyIn]);
      const moneyOut = parseMoney(cells[mapping.moneyOut]);
      amount = moneyIn === null && moneyOut === null ? null : (moneyIn ?? 0) - Math.abs(moneyOut ?? 0);
    }
    if (amount === null) {
      skipped.push({ row, reason: 'No amount' });
      return;
    }

    const balance = mapping.balance === -1 ? null : parseMoney(cells[mapping.balance]);
    const id = mapping.id === -1 ? '' : (cells[mapping.id] ?? '').trim();
    parsed.push({ row, date, description, amount, balance, id });
  });

  resolveYears(parsed, fallbackYear);

  const seen = new Map<string, number>();
  const transactions: Transaction[] = parsed.map((p) => {
    const date = `${p.date.year}-${pad(p.date.month)}-${pad(p.date.day)}`;
    // Identical rows on the same day (e.g. two coffees) are told apart by their
    // running balance, or by how many times the row has appeared so far.
    let key = [date, p.description, p.amount, p.balance ?? ''].join('|');
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n > 1) key += `|${n}`;
    return {
      id: p.id || hash(key),
      date,
      description: p.description,
      merchant: merchantName(p.description),
      amount: p.amount,
      balance: p.balance,
      category: null,
      categorySource: null,
    };
  });

  // Check each running balance against the one before it. Some banks list
  // newest first, so check both orders and keep whichever fits better.
  const oldestFirst: number[] = [];
  const newestFirst: number[] = [];
  for (let i = 1; i < parsed.length; i++) {
    const prev = parsed[i - 1];
    const cur = parsed[i];
    if (prev.balance === null || cur.balance === null) continue;
    if (prev.balance + cur.amount !== cur.balance) oldestFirst.push(cur.row);
    if (cur.balance + prev.amount !== prev.balance) newestFirst.push(prev.row);
  }
  const balanceMismatches = oldestFirst.length <= newestFirst.length ? oldestFirst : newestFirst;

  return { transactions, skipped, balanceMismatches };
}

/**
 * +1 when the month jumps back a long way between consecutive rows (Dec -> Jan
 * in an oldest-first file), -1 when it jumps forward (Jan -> Dec in a
 * newest-first file), otherwise 0.
 */
function monthWrap(prevMonth: number, month: number): number {
  if (month < prevMonth - 6) return 1;
  if (month > prevMonth + 6) return -1;
  return 0;
}

function resolveYears(parsed: { date: PartialDate; description: string }[], fallbackYear: number): void {
  // First pass: years the file states outright.
  const hints = parsed.map((p) => p.date.year ?? yearHint(p.description, p.date.month));
  const firstKnown = hints.findIndex((y) => y !== null);
  if (firstKnown === -1) {
    // Nothing to go on: count forward from the fallback year.
    let year = fallbackYear;
    parsed.forEach((p, i) => {
      if (i > 0) year += monthWrap(parsed[i - 1].date.month, p.date.month);
      p.date.year = year;
    });
    return;
  }

  // Walk backwards from the first known year, then forwards, carrying the year
  // across rows without one and stepping it when the month wraps around.
  let year = hints[firstKnown]!;
  for (let i = firstKnown; i >= 0; i--) {
    if (hints[i] !== null) year = hints[i]!;
    else if (i < parsed.length - 1) year -= monthWrap(parsed[i].date.month, parsed[i + 1].date.month);
    parsed[i].date.year = year;
  }
  year = hints[firstKnown]!;
  for (let i = firstKnown + 1; i < parsed.length; i++) {
    if (hints[i] !== null) year = hints[i]!;
    else year += monthWrap(parsed[i - 1].date.month, parsed[i].date.month);
    parsed[i].date.year = year;
  }
}
