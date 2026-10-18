import type { Transaction } from './types';

function cell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function pounds(pence: number): string {
  return (pence / 100).toFixed(2);
}

/**
 * The balance before the first transaction, worked back from the first one the
 * bank gave a running balance for. Null when no statement had balances.
 */
export function impliedOpeningBalance(transactions: Transaction[]): number | null {
  let total = 0;
  for (const t of transactions) {
    total += t.amount;
    if (t.balance !== null) return t.balance - total;
  }
  return null;
}

/** The balance after each transaction, by id, adding up from `opening` in the order saved (oldest first). */
export function runningBalances(transactions: Transaction[], opening: number): Map<string, number> {
  const balances = new Map<string, number>();
  let balance = opening;
  for (const t of transactions) {
    balance += t.amount;
    balances.set(t.id, balance);
  }
  return balances;
}

/**
 * Transactions as CSV, in columns the importer reads. The balance comes from
 * `balances` when given, otherwise from the bank where it gave one. The last
 * column is this app's id, so importing the file again skips the transactions
 * already saved instead of adding them twice.
 */
export function toCsv(transactions: Transaction[], balances?: Map<string, number>): string {
  const balanceOf = (t: Transaction) => (balances ? (balances.get(t.id) ?? null) : t.balance);
  const withBalance = transactions.some((t) => balanceOf(t) !== null);
  const rows = [['Date', 'Description', 'Money in', 'Money out', ...(withBalance ? ['Balance'] : []), 'Merchant', 'Category', 'Id']];
  for (const t of transactions) {
    const balance = balanceOf(t);
    rows.push([
      t.date,
      t.description,
      t.amount > 0 ? pounds(t.amount) : '',
      t.amount < 0 ? pounds(-t.amount) : '',
      ...(withBalance ? [balance === null ? '' : pounds(balance)] : []),
      t.merchant,
      t.category ?? '',
      t.id,
    ]);
  }
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Starts a download of `text` as a file in the browser. */
export function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
