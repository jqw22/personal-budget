import type { Transaction } from './types';

function cell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function pounds(pence: number): string {
  return (pence / 100).toFixed(2);
}

/**
 * Transactions as CSV, in columns the importer reads. The balance is included
 * when the bank gave one, so importing the file again skips the transactions
 * already saved instead of adding them twice.
 */
export function toCsv(transactions: Transaction[]): string {
  const withBalance = transactions.some((t) => t.balance !== null);
  const rows = [['Date', 'Description', 'Money in', 'Money out', ...(withBalance ? ['Balance'] : []), 'Merchant', 'Category']];
  for (const t of transactions) {
    rows.push([
      t.date,
      t.description,
      t.amount > 0 ? pounds(t.amount) : '',
      t.amount < 0 ? pounds(-t.amount) : '',
      ...(withBalance ? [t.balance === null ? '' : pounds(t.balance)] : []),
      t.merchant,
      t.category ?? '',
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
