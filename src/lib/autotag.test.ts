import { describe, expect, it } from 'vitest';
import { tagRequest, untaggedMerchants } from './autotag';
import { emptyData } from './store';
import type { Transaction } from './types';

const t = (id: string, merchant: string, amount: number, category: string | null = null): Transaction => ({
  id, date: '2026-06-01', description: `${merchant} REF 99887766`, merchant, amount, balance: null, category, categorySource: category ? 'rule' : null,
});

const data = {
  ...emptyData(),
  essential: ['Living/Food'],
  rules: [{ id: 'r', match: 'TESCO', category: 'Living/Food' }],
  transactions: [
    t('a', 'TESCO', -1000, 'Living/Food'),
    t('b', 'PRET A MANGER', -450),
    t('c', 'PRET A MANGER', -520),
    t('d', 'PRET A MANGER', -900),
    t('e', 'NETFLIX', -1099),
  ],
};

describe('untaggedMerchants', () => {
  it('lists each untagged merchant once, most frequent first, with a typical amount', () => {
    expect(untaggedMerchants(data)).toEqual([
      { merchant: 'PRET A MANGER', count: 3, typical: -520 },
      { merchant: 'NETFLIX', count: 1, typical: -1099 },
    ]);
  });
});

describe('tagRequest', () => {
  it('sends merchants, categories with their types and existing rules, but no descriptions', () => {
    const request = tagRequest(data, untaggedMerchants(data));
    expect(request.merchants).toEqual(['PRET A MANGER|3|-5.20', 'NETFLIX|1|-10.99']);
    expect(request.examples).toEqual(['TESCO → Living/Food']);
    expect(request.categories).toMatchObject({ 'Living/Food': 'essential', 'Going Out': 'discretionary', Income: 'not spending' });
    expect(JSON.stringify(request)).not.toContain('99887766');
  });
});
