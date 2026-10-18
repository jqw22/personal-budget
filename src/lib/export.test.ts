import { describe, expect, it } from 'vitest';
import { impliedOpeningBalance, runningBalances, toCsv } from './export';
import { guessMapping, importRows, readCsv } from './importer';
import type { Transaction } from './types';

const t = (id: string, description: string, amount: number, category: string | null): Transaction => ({
  id, date: '2026-06-01', description, merchant: description.split(/[ ,]/)[0], amount, balance: null, category, categorySource: null,
});

describe('toCsv', () => {
  const transactions = [t('a', 'TESCO, "EXPRESS"', -1234, 'Living/Food'), t('b', 'SALARY', 200000, null)];
  const csv = toCsv(transactions);

  it('writes money in and out as pounds and quotes awkward text', () => {
    expect(csv.split('\r\n')).toEqual([
      'Date,Description,Money in,Money out,Merchant,Category,Id',
      '2026-06-01,"TESCO, ""EXPRESS""",,12.34,TESCO,Living/Food,a',
      '2026-06-01,SALARY,2000.00,,SALARY,,b',
      '',
    ]);
  });

  it('keeps the balance, so importing the file again finds the same transactions', () => {
    const { headers, rows } = readCsv(
      'Date,Description, In , Out , Balance\n21-May,SHOP ON 20-05-2026,,5.00,95.00\n21-May,SHOP ON 20-05-2026,,5.00,90.00\n',
    );
    const original = importRows(rows, guessMapping(headers), 2026).transactions;
    const again = readCsv(toCsv(original));
    expect(importRows(again.rows, guessMapping(again.headers), 2026).transactions.map((x) => x.id)).toEqual(
      original.map((x) => x.id),
    );
  });

  it('can be imported again with the same dates, descriptions and amounts', () => {
    const { headers, rows } = readCsv(csv);
    const back = importRows(rows, guessMapping(headers), 2026).transactions;
    expect(back.map((x) => [x.date, x.description, x.amount])).toEqual(transactions.map((x) => [x.date, x.description, x.amount]));
  });

  it('writes a balance worked out from the opening balance on every row', () => {
    const rows = toCsv(transactions, runningBalances(transactions, 10000)).split('\r\n');
    expect(rows[0]).toBe('Date,Description,Money in,Money out,Balance,Merchant,Category,Id');
    expect(rows.slice(1, 3).map((r) => r.split(',').at(-4))).toEqual(['87.66', '2087.66']);
  });

  it('gives back the same transactions when imported again, even without a bank balance', () => {
    const again = readCsv(toCsv(transactions, runningBalances(transactions, 0)));
    expect(importRows(again.rows, guessMapping(again.headers), 2026).transactions.map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('impliedOpeningBalance', () => {
  it('works back from the first balance the bank gave', () => {
    const withBalance = [t('a', 'X', -500, null), { ...t('b', 'Y', -1000, null), balance: 8500 }, { ...t('c', 'Z', 200, null), balance: 8700 }];
    expect(impliedOpeningBalance(withBalance)).toBe(10000);
  });

  it('is null when no transaction has a balance', () => {
    expect(impliedOpeningBalance([t('a', 'X', -500, null)])).toBeNull();
  });
});
