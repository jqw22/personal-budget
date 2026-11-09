import { describe, expect, it } from 'vitest';
import { amountIn, expandSplits, isTagged, splitProblem, withSplit } from './splits';
import { categoryHistory } from './summary';
import { impliedOpeningBalance } from './export';
import type { Transaction } from './types';

const t: Transaction = {
  id: 'abc', date: '2026-09-04', description: 'TESCO STORES 1234', merchant: 'TESCO', amount: -5000, balance: 95000,
  category: 'Living/Food', categorySource: 'rule',
};
const parts = [
  { amount: -3000, category: 'Living/Food' },
  { amount: -2000, category: 'Going Out' },
];

describe('splits', () => {
  it('keeps every imported field when splitting and when removing the split', () => {
    const split = withSplit(t, parts);
    expect(split).toMatchObject({ id: 'abc', date: '2026-09-04', description: 'TESCO STORES 1234', amount: -5000, balance: 95000 });
    expect(split.splits).toEqual(parts);
    const back = withSplit(split, null);
    expect(back.splits).toBeUndefined();
    expect(back).toMatchObject({ id: 'abc', amount: -5000, balance: 95000, category: null, categorySource: null });
  });

  it('only accepts parts that add up to the whole, with the same sign and a category each', () => {
    expect(splitProblem(t, parts)).toBeNull();
    expect(splitProblem(t, [{ amount: -3000, category: 'Living/Food' }, { amount: -1000, category: 'Going Out' }])).toMatch(/add up/);
    expect(splitProblem(t, [{ amount: -6000, category: 'Living/Food' }, { amount: 1000, category: 'Going Out' }])).toMatch(/more than/);
    expect(splitProblem(t, [{ amount: -3000, category: 'Living/Food' }, { amount: -2000, category: '' }])).toMatch(/category/);
    expect(splitProblem(t, [{ amount: -5000, category: 'Living/Food' }])).toMatch(/two/);
  });

  it('counts a split as its parts by category, without changing balances', () => {
    const split = withSplit(t, parts);
    const before: Transaction = { ...t, id: 'first', date: '2026-09-01', amount: -1000, balance: 100000 };
    const history = categoryHistory(expandSplits([before, split]), '2026-09', 1);
    expect(Object.fromEntries(history.rows.map((r) => [r.category, r.amounts[0]]))).toEqual({ 'Living/Food': 4000, 'Going Out': 2000 });
    expect(impliedOpeningBalance(expandSplits([before, split]))).toBe(impliedOpeningBalance([before, split]));
    expect(isTagged(split)).toBe(true);
    expect(amountIn(split, 'Going Out')).toBe(-2000);
    expect(amountIn(t, 'Going Out')).toBe(-5000);
  });
});
