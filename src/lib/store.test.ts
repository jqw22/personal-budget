import { describe, expect, it } from 'vitest';
import { addCategory, categoryUse, emptyData, migrate, removeCategory, renameCategory, setArchived } from './store';
import { incomeCategories, typeList, type BudgetData, type Transaction } from './types';

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
    expect(data.version).toBe(5);
    expect(data.categories).toEqual(['Living/Food', 'Going Out', 'Holidays', 'Subscriptions', 'Other', 'Transfers', 'Income']);
    expect(data.rules[0].category).toBe('Living/Food');
    expect(data.transactions.map((t) => t.category)).toEqual(['Living/Food', 'Subscriptions', 'Other', null]);
  });

  it('leaves data from version 2 alone, so a re-added "Groceries" stays', () => {
    const data = { ...oldData, version: 2 };
    expect(migrate(data).categories).toEqual([...oldData.categories, 'Transfers', 'Income']);
  });

  it('turns categories marked with * into essential ones and drops the *', () => {
    const marked: BudgetData = {
      version: 2,
      categories: ['Rent & bills*', 'Living/Food *', 'Going Out'],
      rules: [{ id: 'r1', match: 'TESCO', category: 'Living/Food *' }],
      transactions: [tx('a', 'Rent & bills*'), tx('b', 'Going Out')],
      forecast: { '2026-07': { 'Rent & bills*': 90000 } },
    };
    const data = migrate(marked);
    expect(data.categories).toEqual(['Rent & bills', 'Living/Food', 'Going Out', 'Transfers', 'Income']);
    expect(data.categoryTypes).toEqual({ 'Rent & bills': 'Essential', 'Living/Food': 'Essential', 'Going Out': 'Discretionary' });
    expect(data.rules[0].category).toBe('Living/Food');
    expect(data.transactions[0].category).toBe('Rent & bills');
    expect(data.forecast).toEqual({ '2026-07': { 'Rent & bills': 90000 } });
  });

  it('puts Income and Transfers in an Income group at the top when upgrading to version 5', () => {
    const data = migrate({ ...oldData, version: 4, categories: ['Rent', 'Income', 'Transfers'], types: ['Essential', 'Fun'], categoryTypes: { Rent: 'Essential', Transfers: 'Fun' } });
    expect(data.types).toEqual(['Income', 'Essential', 'Fun']);
    expect(data.incomeGroups).toEqual(['Income']);
    expect(incomeCategories(data)).toEqual(['Income', 'Transfers']);
    // After that they are ordinary categories: removing them sticks.
    const later = migrate({ ...data, categories: ['Rent'], deletedCategories: ['Income', 'Transfers'] });
    expect(later.categories).toEqual(['Rent']);
  });

  it('brings back Income and Transfers removed before version 5', () => {
    const data = migrate({ ...oldData, version: 4, categories: ['Other', 'Income'], deletedCategories: ['Transfers', 'Old'] });
    expect(data.categories).toEqual(['Other', 'Income', 'Transfers']);
    expect(data.deletedCategories).toEqual(['Old']);
  });
});

describe('renameCategory', () => {
  it('merges into an existing category of the same name without duplicating it', () => {
    const data = renameCategory({ ...oldData, categories: ['Groceries', 'Living/Food'] }, 'Groceries', 'Living/Food');
    expect(data.categories).toEqual(['Living/Food']);
  });
});

describe('a new budget', () => {
  it('starts with no categories and no groups', () => {
    const data = emptyData();
    expect(data.categories).toEqual([]);
    expect(typeList(data)).toEqual([]);
  });
});

describe('adding, archiving and removing categories', () => {
  const start = { ...emptyData(), types: ['Bills'], transactions: [tx('a', 'Rent')], rules: [{ id: 'r', match: 'LANDLORD', category: 'Rent' }] };

  it('adds a category to a group and takes it off the deleted and archived lists', () => {
    const data = addCategory({ ...start, deletedCategories: ['Rent'], archivedCategories: ['Rent'] }, 'Rent', 'Bills');
    expect(data.categories).toEqual(['Rent']);
    expect(data.categoryTypes).toEqual({ Rent: 'Bills' });
    expect(data.deletedCategories).toEqual([]);
    expect(data.archivedCategories).toEqual([]);
  });

  it('archives without touching transactions or rules, and brings it back', () => {
    const added = addCategory(start, 'Rent', 'Bills');
    const archived = setArchived(added, 'Rent', true);
    expect(archived.archivedCategories).toEqual(['Rent']);
    expect(archived.transactions[0].category).toBe('Rent');
    expect(archived.rules).toHaveLength(1);
    expect(setArchived(archived, 'Rent', false).archivedCategories).toEqual([]);
  });

  it('removes a category, untagging its transactions and deleting its rules', () => {
    const added = addCategory(start, 'Rent', 'Bills');
    expect(categoryUse(added, 'Rent')).toEqual({ transactions: 1, rules: 1 });
    const removed = removeCategory(added, 'Rent');
    expect(removed.categories).toEqual([]);
    expect(removed.transactions[0].category).toBeNull();
    expect(removed.rules).toEqual([]);
    expect(removed.deletedCategories).toEqual(['Rent']);
  });
});
