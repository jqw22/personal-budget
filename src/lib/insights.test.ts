import { describe, expect, it } from 'vitest';
import { reviewData } from './insights';
import { emptyData } from './store';
import type { Transaction } from './types';

const t = (id: string, date: string, amount: number, category: string | null, description = 'MR J SMITH CAFE'): Transaction => ({
  id, date, description, merchant: description, amount, balance: null, category, categorySource: category ? 'manual' : null,
});

const data = {
  ...emptyData(),
  essential: ['Rent & bills'],
  openingBalance: 100000,
  goals: [{ id: 'g', text: 'Save £3,000 by June' }],
  transactions: [
    t('a', '2026-05-01', 200000, 'Income', 'ACME PAYROLL'),
    t('b', '2026-05-02', -80000, 'Rent & bills', 'LANDLORD J BLOGGS'),
    t('c', '2026-05-10', -5050, 'Going Out'),
    t('d', '2026-06-01', 200000, 'Income', 'ACME PAYROLL'),
    t('e', '2026-06-02', -80000, 'Rent & bills', 'LANDLORD J BLOGGS'),
    t('f', '2026-06-12', -7000, 'Going Out'),
    t('g', '2026-06-15', -1000, null),
  ],
};

describe('reviewData', () => {
  const review = reviewData(data, '2026-06-20')!;

  it('sends monthly totals in whole pounds, with each category type', () => {
    expect(review.actual).toEqual([
      { month: '2026-05', income: 2000, spending: { 'Rent & bills': 800, 'Going Out': 51 }, totalSpending: 851, untaggedMoneyIn: 0, closingBalance: 2150 },
      { month: '2026-06', income: 2000, spending: { 'Rent & bills': 800, 'Going Out': 70, Untagged: 10 }, totalSpending: 880, untaggedMoneyIn: 0, closingBalance: 3270 },
    ]);
    expect(review.categories).toEqual({ 'Rent & bills': 'essential', 'Going Out': 'discretionary', Untagged: 'untagged' });
    expect(review.latestMonth).toEqual({ month: '2026-06', firstDate: '2026-06-01', lastDate: '2026-06-15' });
  });

  it('includes the forecast from the latest balance, and the goals', () => {
    expect(review.forecast[0]).toMatchObject({ month: '2026-07', income: 2000, totalSpending: 865, closingBalance: 4405 });
    expect(review.goals).toEqual(['Save £3,000 by June']);
  });

  it('leaves out descriptions and payees', () => {
    const sent = JSON.stringify(review);
    for (const name of ['SMITH', 'BLOGGS', 'ACME', 'CAFE']) expect(sent).not.toContain(name);
  });

  it('is null with no transactions', () => {
    expect(reviewData(emptyData(), '2026-06-20')).toBeNull();
  });
});
