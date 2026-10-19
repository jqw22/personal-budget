import { describe, expect, it } from 'vitest';
import { categoryHistory, closingBalances, dailyBalances, dailyForecast, groupSpending, nextMonth, previousMonth } from './summary';
import type { Transaction } from './types';

let n = 0;
function tx(date: string, amount: number, category: string | null): Transaction {
  n++;
  return { id: String(n), date, description: '', merchant: '', amount, balance: null, category, categorySource: null };
}

const transactions = [
  tx('2026-05-03', -2000, 'Living/Food'),
  tx('2026-05-20', -1000, 'Going Out'),
  tx('2026-06-01', -3000, 'Living/Food'),
  tx('2026-06-02', 500, 'Living/Food'), // refund
  tx('2026-06-03', -4000, 'Going Out'),
  tx('2026-06-04', -10000, 'Transfers'),
  tx('2026-06-05', 200000, 'Income'),
  tx('2026-06-06', -700, null),
  tx('2026-06-07', 1260, null), // untagged money in
];

describe('previousMonth', () => {
  it('steps back a month, across years too', () => {
    expect(previousMonth('2026-06')).toBe('2026-05');
    expect(previousMonth('2026-01')).toBe('2025-12');
  });

  it('steps forward a month, across years too', () => {
    expect(nextMonth('2026-06')).toBe('2026-07');
    expect(nextMonth('2026-12')).toBe('2027-01');
  });
});

describe('categoryHistory', () => {
  it('counts the year to date from January, including months before the ones shown', () => {
    const h = categoryHistory([tx('2025-12-01', -900, 'Holidays'), tx('2026-01-10', -800, 'Holidays'), ...transactions], '2026-06', 4);
    expect(h.rows.find((r) => r.category === 'Holidays')).toEqual({ category: 'Holidays', amounts: [0, 0, 0, 0], ytd: 800 });
    expect(h.ytd.months).toBe(3);
  });

  it('puts the biggest spend this year first', () => {
    const h = categoryHistory([tx('2026-01-10', -9000, 'Holidays'), ...transactions], '2026-06', 4);
    expect(h.rows.map((r) => r.category)).toEqual(['Holidays', 'Going Out', 'Living/Food', 'Untagged']);
  });

  it('covers the given number of months, oldest first, with totals', () => {
    const h = categoryHistory(transactions, '2026-06', 4);
    expect(h.months).toEqual(['2026-03', '2026-04', '2026-05', '2026-06']);
    expect(h.rows).toEqual([
      { category: 'Going Out', amounts: [0, 0, 1000, 4000], ytd: 5000 },
      { category: 'Living/Food', amounts: [0, 0, 2000, 2500], ytd: 4500 },
      { category: 'Untagged', amounts: [0, 0, 0, 700], ytd: 700 },
    ]);
    expect(h.ytd).toEqual({ months: 2, total: 10200, income: 200000 });
    expect(h.totals).toEqual([0, 0, 3000, 7200]);
    expect(h.income).toEqual([0, 0, 0, 200000]);
  });
});

describe('closingBalances', () => {
  it('adds every transaction up to the end of each month onto the opening balance', () => {
    const list = [tx('2026-05-03', -2000, null), tx('2026-05-31', 50000, 'Income'), tx('2026-06-01', -1000, 'Transfers')];
    expect(closingBalances(list, 10000, ['2026-04', '2026-05', '2026-06'])).toEqual([10000, 58000, 57000]);
  });
});

describe('groupSpending', () => {
  it('puts essential rows first, then discretionary, then untagged', () => {
    const rows = [{ category: 'Going Out' }, { category: 'Untagged' }, { category: 'Rent & bills' }, { category: 'Holidays' }];
    expect(groupSpending(rows, ['Rent & bills']).map((g) => [g.label, g.rows.map((r) => r.category)])).toEqual([
      ['Essential', ['Rent & bills']],
      ['Discretionary', ['Going Out', 'Holidays']],
      [null, ['Untagged']],
    ]);
  });
});

describe('dailyBalances', () => {
  it('gives the balance at the end of every day from the first transaction to the last', () => {
    const list = [tx('2026-05-30', -500, null), tx('2026-05-30', -500, null), tx('2026-06-02', 2000, null)];
    expect(dailyBalances(list, 10000, '2026-01-01', '2026-12-31')).toEqual([
      { date: '2026-05-30', balance: 9000 },
      { date: '2026-05-31', balance: 9000 },
      { date: '2026-06-01', balance: 9000 },
      { date: '2026-06-02', balance: 11000 },
    ]);
  });

  it('carries in everything before the range as the balance on its first day', () => {
    const list = [tx('2025-12-31', -500, null), tx('2026-01-02', -100, null)];
    expect(dailyBalances(list, 1000, '2026-01-01', '2026-12-31')).toEqual([
      { date: '2026-01-01', balance: 500 },
      { date: '2026-01-02', balance: 400 },
    ]);
  });
});

describe('dailyForecast', () => {
  const tx = (id: string, date: string, amount: number, category: string): Transaction => ({
    id, date, description: id, merchant: id, amount, balance: null, category, categorySource: 'manual',
  });
  // June has income of £3,000 and spending of £2,070, so the average month is £930 under.
  const transactions = [tx('a', '2026-06-01', 300000, 'Income'), tx('b', '2026-06-02', -207000, 'Rent & bills')];
  const history = categoryHistory(transactions, '2026-06', 1);

  it('spreads each month evenly over its days, starting the day after the last transaction', () => {
    const days = dailyForecast(history, undefined, { date: '2026-06-28', balance: 100000 }, '2026-07-31');
    expect(days[0]).toEqual({ date: '2026-06-29', balance: 103100 });
    expect(days.find((d) => d.date === '2026-06-30')!.balance).toBe(106200);
    expect(days.at(-1)).toEqual({ date: '2026-07-31', balance: 199200 });
  });

  it("uses the user's own forecast figures for a month", () => {
    const days = dailyForecast(history, { '2026-07': { Income: 0 } }, { date: '2026-06-30', balance: 0 }, '2026-07-31');
    expect(days.at(-1)!.balance).toBe(-207000);
  });
});
