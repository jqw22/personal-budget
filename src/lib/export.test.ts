import { describe, expect, it } from 'vitest';
import { toCsv } from './export';
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
      'Date,Description,Money in,Money out,Merchant,Category',
      '2026-06-01,"TESCO, ""EXPRESS""",,12.34,TESCO,Living/Food',
      '2026-06-01,SALARY,2000.00,,SALARY,',
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
});
