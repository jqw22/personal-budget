import { describe, expect, it } from 'vitest';
import { migrate, renameCategory } from './store';
import type { BudgetData, Transaction } from './types';

function tx(id: string, category: string | null): Transaction {
  return { id, date: '2026-06-01', description: id, merchant: id, amount: -100, balance: null, category, categorySource: 'manual' };
}

const oldData: BudgetData = {
  categories: ['Groceries', 'Eating out', 'Travel', 'Fees', 'Other'],
  rules: [{ id: 'r1', match: 'TESCO', category: 'Groceries' }],
  transactions: [tx('a', 'Groceries'), tx('b', 'Fees'), tx('c', 'Other'), tx('d', null)],
};

describe('migrate', () => {
  it('moves data saved before version 2 onto the renamed categories', () => {
    const data = migrate(oldData);
    expect(data.version).toBe(2);
    expect(data.categories).toEqual(['Living/Food', 'Going Out', 'Holidays', 'Subscriptions', 'Other']);
    expect(data.rules[0].category).toBe('Living/Food');
    expect(data.transactions.map((t) => t.category)).toEqual(['Living/Food', 'Subscriptions', 'Other', null]);
  });

  it('leaves data from version 2 alone, so a re-added "Groceries" stays', () => {
    const data = { ...oldData, version: 2 };
    expect(migrate(data).categories).toEqual(oldData.categories);
  });
});

describe('renameCategory', () => {
  it('merges into an existing category of the same name without duplicating it', () => {
    const data = renameCategory({ ...oldData, categories: ['Groceries', 'Living/Food'] }, 'Groceries', 'Living/Food');
    expect(data.categories).toEqual(['Living/Food']);
  });
});
