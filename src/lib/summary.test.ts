import { describe, expect, it } from 'vitest';
import { categoryHistory, closingBalances, dailyBalances, dailyForecast, forecastFrom, groupSpending, incomePaydays, nextMonth, previousMonth } from './summary';
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

// May is a full month: £3,000 paid on the 25th, £1,000 rent and £248 food. June is imported up to the 10th.
function forecastData(): Transaction[] {
  const tx = (id: string, date: string, amount: number, category: string, merchant = id): Transaction => ({
    id, date, description: merchant, merchant, amount, balance: null, category, categorySource: 'manual',
  });
  return [
    tx('a', '2026-05-01', -100000, 'Rent & bills', 'RENT'),
    tx('b', '2026-05-25', 300000, 'Income', 'EMPLOYER'),
    tx('c', '2026-05-31', -24800, 'Living/Food', 'TESCO'),
    tx('d', '2026-06-01', -100000, 'Rent & bills', 'RENT'),
    tx('e', '2026-06-10', -10000, 'Living/Food', 'TESCO'),
  ];
}

describe('forecastFrom', () => {
  const amounts = (f: ReturnType<typeof forecastFrom>, category: string) => f.rows.find((r) => r.category === category)!.amounts;

  it("starts with the rest of the month being imported: the average of the months before, less what's gone so far", () => {
    const f = forecastFrom(forecastData(), undefined, 0);
    expect(f.months).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(f.restOf).toBe('2026-06');
    expect(f.income[0]).toBe(300000);
    expect(amounts(f, 'Rent & bills').slice(0, 2)).toEqual([0, 100000]);
    expect(amounts(f, 'Living/Food').slice(0, 2)).toEqual([14800, 24800]);
    // The actual balance now, £652, plus the rest of June's +£2,852.
    expect(f.closing[0]).toBe(350400);
  });

  it('starts with the next month once the latest is complete', () => {
    const data = [...forecastData(), { ...forecastData()[4], id: 'f', date: '2026-06-30', amount: -50000 }];
    const f = forecastFrom(data, undefined, 0);
    expect(f.restOf).toBeNull();
    expect(f.months).toEqual(['2026-07', '2026-08', '2026-09', '2026-10']);
    expect(amounts(f, 'Living/Food')[0]).toBe(42400);
    expect(f.closing[0]).toBe(15200 + 150000 - 142400);
  });

  it('adds a row for each spending category with nothing spent yet, using any figure typed in', () => {
    const f = forecastFrom(forecastData(), { '2026-07': { Holidays: 50000 } }, null, ['Living/Food', 'Holidays', 'Drinks', 'Income', 'Transfers'], 2);
    expect(f.rows.map((r) => r.category).slice(-2)).toEqual(['Drinks', 'Holidays']);
    expect(amounts(f, 'Holidays')).toEqual([0, 50000, 0]);
    expect(f.rows.some((r) => r.category === 'Income' || r.category === 'Transfers')).toBe(false);
  });
});

describe('dailyForecast', () => {
  const from = { date: '2026-06-10', balance: 0 };

  it("spreads what's left of this month's spending over the days left, and pays income on its usual day", () => {
    const days = dailyForecast(forecastData(), undefined, from, '2026-07-31');
    // The rest of June's £148 forecast spending over the 20 days left.
    expect(days[0]).toEqual({ date: '2026-06-11', balance: -740 });
    expect(days.find((d) => d.date === '2026-06-24')!.balance).toBe(-10360);
    expect(days.find((d) => d.date === '2026-06-25')!.balance).toBe(288900);
    expect(days.find((d) => d.date === '2026-06-30')!.balance).toBe(285200);
    expect(days.at(-1)).toEqual({ date: '2026-07-31', balance: 460400 });
  });

  it("uses the user's own figures for the rest of this month", () => {
    const days = dailyForecast(forecastData(), { '2026-06': { Income: 0, 'Living/Food': 50000 } }, from, '2026-06-30');
    expect(days[0].balance).toBe(-2500);
    expect(days.at(-1)!.balance).toBe(-50000);
  });

  it('skips income already received this month', () => {
    const paid = [...forecastData(), { ...forecastData()[1], id: 'f', date: '2026-06-10' }];
    const days = dailyForecast(paid, undefined, from, '2026-06-30');
    expect(days.at(-1)!.balance).toBe(-14800);
  });

  it("moves a payday the month doesn't have to its last day", () => {
    const data = forecastData().map((t) => (t.id === 'b' ? { ...t, date: '2026-05-31' } : t));
    const days = dailyForecast(data, undefined, from, '2026-06-30');
    expect(days.find((d) => d.date === '2026-06-29')!.balance).toBe(-14060);
    expect(days.at(-1)!.balance).toBe(285200);
  });
});

describe('incomePaydays', () => {
  it('finds the usual day and share of each income', () => {
    const tx = (date: string, amount: number, merchant: string): Transaction => ({
      id: date + merchant, date, description: '', merchant, amount, balance: null, category: 'Income', categorySource: 'manual',
    });
    const paydays = incomePaydays(
      [tx('2026-04-24', 300000, 'EMPLOYER'), tx('2026-05-25', 300000, 'EMPLOYER'), tx('2026-06-25', 300000, 'EMPLOYER'), tx('2026-06-10', 100000, 'RENT IN')],
      '2026-06',
    );
    expect(paydays).toEqual([
      { merchant: 'EMPLOYER', day: 25, share: 0.9 },
      { merchant: 'RENT IN', day: 10, share: 0.1 },
    ]);
  });
});
