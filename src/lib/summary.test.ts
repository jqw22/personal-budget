import { describe, expect, it } from 'vitest';
import { categoryHistory, previousMonth, summarise } from './summary';
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
});

describe('summarise', () => {
  const s = summarise(transactions, '2026-06');

  it('totals spending, leaving out transfers, income and untagged money in', () => {
    expect(s.spent).toBe(3000 - 500 + 4000 + 700);
    expect(s.previousSpent).toBe(3000);
    expect(s.income).toBe(200000);
  });

  it('lists categories by spend, with last month alongside', () => {
    expect(s.lines).toEqual([
      { category: 'Going Out', spent: 4000, previous: 1000 },
      { category: 'Living/Food', spent: 2500, previous: 2000 },
      { category: 'Untagged', spent: 700, previous: 0 },
    ]);
  });

  it('keeps a category spent on last month but not this month', () => {
    const may = summarise([tx('2026-04-01', -100, 'Holidays'), ...transactions], '2026-05');
    expect(may.lines.find((l) => l.category === 'Holidays')).toEqual({ category: 'Holidays', spent: 0, previous: 100 });
  });
});

describe('categoryHistory', () => {
  it('covers the given number of months, oldest first, with totals', () => {
    const h = categoryHistory(transactions, '2026-06', 4);
    expect(h.months).toEqual(['2026-03', '2026-04', '2026-05', '2026-06']);
    expect(h.rows).toEqual([
      { category: 'Going Out', amounts: [0, 0, 1000, 4000] },
      { category: 'Living/Food', amounts: [0, 0, 2000, 2500] },
      { category: 'Untagged', amounts: [0, 0, 0, 700] },
    ]);
    expect(h.totals).toEqual([0, 0, 3000, 7200]);
    expect(h.income).toEqual([0, 0, 0, 200000]);
  });
});
