import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { guessMapping, importRows, parseDate, parseMoney, readCsv } from './importer';
import { merchantName } from './merchant';

const sample = readFileSync(new URL('./__fixtures__/sample-statement.csv', import.meta.url), 'utf8');

function importSample() {
  const { headers, rows } = readCsv(sample);
  return importRows(rows, guessMapping(headers), 2000);
}

describe('parseMoney', () => {
  it('reads amounts with thousands separators and padding', () => {
    expect(parseMoney(' 2,658.43 ')).toBe(265843);
    expect(parseMoney(' 0.89 ')).toBe(89);
    expect(parseMoney('-5.9')).toBe(-590);
    expect(parseMoney('(5.90)')).toBe(-590);
    expect(parseMoney('£10')).toBe(1000);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
  });
});

describe('parseDate', () => {
  it('reads the formats banks commonly export', () => {
    expect(parseDate('21-May')).toEqual({ day: 21, month: 5, year: null });
    expect(parseDate('21 May 2026')).toEqual({ day: 21, month: 5, year: 2026 });
    expect(parseDate('21/05/26')).toEqual({ day: 21, month: 5, year: 2026 });
    expect(parseDate('2026-05-21')).toEqual({ day: 21, month: 5, year: 2026 });
    expect(parseDate('nonsense')).toBeNull();
  });
});

describe('importRows', () => {
  it('maps the split In/Out columns despite padded headers', () => {
    const { headers } = readCsv(sample);
    expect(guessMapping(headers)).toEqual({ date: 0, description: 1, moneyIn: 2, moneyOut: 3, amount: -1, balance: 4, id: -1 });
  });

  it('skips the balance line and blank rows, and keeps multi-line descriptions', () => {
    const { transactions, skipped } = importSample();
    expect(transactions).toHaveLength(9);
    expect(skipped).toEqual([{ row: 2, reason: 'Balance line, not a transaction' }]);
    expect(transactions[3].description).toMatch(/MANDATE NO 0123$/);
  });

  it('signs amounts: money out negative, money in positive', () => {
    const { transactions } = importSample();
    expect(transactions[0].amount).toBe(-1250);
    expect(transactions[6].amount).toBe(2000);
    expect(transactions[8].amount).toBe(150000);
  });

  it('works out the year from card dates and rolls over at New Year', () => {
    const dates = importSample().transactions.map((t) => t.date);
    expect(dates).toEqual([
      '2025-12-30',
      '2025-12-31',
      '2025-12-31',
      '2026-01-02',
      '2026-01-02',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
      '2026-01-05',
    ]);
  });

  it('falls back to the given year when the file never states one', () => {
    const csv = 'Date,Description,Amount\n30-Dec,A,-1.00\n02-Jan,B,-2.00\n';
    const { rows, headers } = readCsv(csv);
    const dates = importRows(rows, guessMapping(headers), 2025).transactions.map((t) => t.date);
    expect(dates).toEqual(['2025-12-30', '2026-01-02']);
  });

  it('gives identical same-day rows different ids, and the same ids on re-import', () => {
    const first = importSample().transactions.map((t) => t.id);
    expect(new Set(first).size).toBe(first.length);
    expect(importSample().transactions.map((t) => t.id)).toEqual(first);
  });

  it('confirms the running balance adds up', () => {
    expect(importSample().balanceMismatches).toEqual([]);
  });
});

describe('merchantName', () => {
  it.each([
    ['TESCO STORES 5458 (VIA APPLE PAY), ON 21-05-2026', 'TESCO STORES'],
    ['SQ *THE COSY CAFE CIC (VIA APPLE PAY), ON 21-05-2026', 'THE COSY CAFE CIC'],
    ['ZETTLE_*BANH MI CO BA (VIA APPLE PAY), ON 27-05-2026', 'BANH MI CO BA'],
    ['SUMUP *UN CAFFE SAS (VIA APPLE PAY), 14.00 EUR RATE 0.8642/GBP, ON 12-06-2026', 'UN CAFFE SAS'],
    ['BOLT.EU/O/2605302123 (VIA APPLE PAY), ON 31-05-2026', 'BOLT.EU'],
    ['REVOLUT**4472* (VIA APPLE PAY), ON 15-06-2026', 'REVOLUT'],
    ['BILL PAYMENT VIA FASTER PAYMENT TO JANE EXAMPLE REFERENCE splitwise , MANDATE NO 0348', 'JANE EXAMPLE'],
    ['BILL PAYMENT TO JANE EXAMPLE REFERENCE splitwise, MANDATE NO00322', 'JANE EXAMPLE'],
    ['BILL PAYMENT FROM MISS JANE ELIZABETH EXAMPLE, REFERENCE parking', 'JANE ELIZABETH EXAMPLE'],
    ['FASTER PAYMENTS RECEIPT REF.drinks taxi FROM J Sample', 'J SAMPLE'],
    ['CARD PAYMENT TO UBER *TRIP ON 09-06-2026', 'UBER TRIP'],
    ['CARD PAYMENT TO WWW.EXAMPLE.IT ,87.00 EUR, RATE 0.8683/GBP ON 31-05-2026', 'WWW.EXAMPLE.IT'],
    ['CREDIT FROM HEYTEA-GB-MCR Chinatn. ON 03-06-2026', 'HEYTEA-GB-MCR CHINATN.'],
    ['BANK GIRO CREDIT REF ACME LTD, 123456 PAYROLL', 'BANK GIRO CREDIT REF ACME LTD'],
    ['FOREIGN CURRENCY CONVERSION FEE', 'FOREIGN CURRENCY CONVERSION FEE'],
  ])('%s -> %s', (description, expected) => {
    expect(merchantName(description)).toBe(expected);
  });
});
