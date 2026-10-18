const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });

export function formatMoney(pence: number): string {
  return money.format(pence / 100);
}

const pounds = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });

/** Rounded to the nearest pound, for summary tables. */
export function formatPounds(pence: number): string {
  return pounds.format(Math.round(pence / 100));
}

export function formatDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "2026-05" -> "May 2026" */
export function formatMonth(yearMonth: string): string {
  return new Date(`${yearMonth}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}
