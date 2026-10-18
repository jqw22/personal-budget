import { describe, expect, it } from 'vitest';
import { keySigner, newSecretKey } from './nostr';
import { emptyData } from './store';
import { applyRemote, fromChunks, latestByTag, mergeData, toChunks } from './sync';
import type { BudgetData, Transaction } from './types';

function tx(id: string, date: string, category: string | null = null, source: Transaction['categorySource'] = null): Transaction {
  return { id, date, description: id, merchant: id, amount: -100, balance: null, category, categorySource: category ? source ?? 'manual' : null };
}

function data(transactions: Transaction[], extra: Partial<BudgetData> = {}): BudgetData {
  return { ...emptyData(), transactions, ...extra };
}

describe('toChunks and fromChunks', () => {
  it('round-trips, with one chunk for settings and one per month', () => {
    const original = data([tx('a', '2026-05-01'), tx('b', '2026-05-02', 'Going Out'), tx('c', '2026-06-01')], {
      rules: [{ id: 'r', match: 'TESCO', category: 'Living/Food' }],
    });
    const chunks = toChunks(original);
    expect([...chunks.keys()].sort()).toEqual([
      'personal-budget:settings',
      'personal-budget:tx:2026-05:000',
      'personal-budget:tx:2026-06:000',
    ]);
    expect(fromChunks(chunks)).toEqual(original);
  });

  it('splits a big month into parts and keeps its order', () => {
    const many = Array.from({ length: 400 }, (_, i) => tx(`t${i}`, '2026-05-01'));
    const chunks = toChunks(data(many));
    const parts = [...chunks.keys()].filter((d) => d.includes('2026-05'));
    expect(parts.length).toBeGreaterThan(1);
    for (const d of parts) expect(chunks.get(d)!.length).toBeLessThan(21000);
    const shuffled = new Map([...chunks].reverse());
    expect(fromChunks(shuffled)!.transactions.map((t) => t.id)).toEqual(many.map((t) => t.id));
  });

  it('returns null when nothing is saved', () => {
    expect(fromChunks(new Map())).toBeNull();
  });
});

describe('mergeData', () => {
  it('keeps one copy of each transaction and adds the ones from either side', () => {
    const local = data([tx('a', '2026-05-01'), tx('b', '2026-05-02', 'Going Out')]);
    const remote = data([tx('b', '2026-05-02', 'Drinks'), tx('c', '2026-05-03')]);
    const merged = mergeData(local, remote);
    expect(merged.transactions.map((t) => [t.id, t.category])).toEqual([
      ['a', null],
      ['b', 'Going Out'],
      ['c', null],
    ]);
  });

  it("gives a device that's never been used exactly the saved categories", () => {
    const remote = data([tx('a', '2026-05-01', 'Pets')], { categories: ['Pets', 'Bills'] });
    expect(mergeData(emptyData(), remote).categories).toEqual(['Pets', 'Bills']);
  });

  it('takes a hand-picked category from the relay copy over an untagged local one', () => {
    const merged = mergeData(data([tx('a', '2026-05-01')]), data([tx('a', '2026-05-01', 'Drinks')]));
    expect(merged.transactions[0].category).toBe('Drinks');
  });

  it('combines rules and categories, and applies rules to what came in', () => {
    const local = data([tx('TESCO', '2026-05-01')], { rules: [{ id: '1', match: 'TESCO', category: 'Living/Food' }] });
    const remote = data([tx('ALDI', '2026-05-02')], {
      categories: [...emptyData().categories, 'Pets'],
      rules: [
        { id: '2', match: 'tesco', category: 'Other' },
        { id: '3', match: 'ALDI', category: 'Living/Food' },
      ],
    });
    const merged = mergeData(local, remote);
    expect(merged.rules.map((r) => r.id)).toEqual(['1', '3']);
    expect(merged.categories.at(-1)).toBe('Pets');
    expect(merged.transactions.map((t) => t.category)).toEqual(['Living/Food', 'Living/Food']);
  });
});

describe('applyRemote', () => {
  const saved = data([tx('a', '2026-05-01'), tx('b', '2026-05-02')]);
  const base = toChunks(saved);

  it("takes another device's newer tags", () => {
    const theirs = toChunks(data([tx('a', '2026-05-01', 'Drinks'), tx('b', '2026-05-02')]));
    const next = applyRemote(saved, base, theirs);
    expect(next.transactions.map((t) => t.category)).toEqual(['Drinks', null]);
  });

  it('keeps an edit made here that has not been saved yet', () => {
    const mine = data([tx('a', '2026-05-01'), tx('b', '2026-05-02', 'Going Out')]);
    const theirs = toChunks(data([tx('a', '2026-05-01', 'Drinks'), tx('b', '2026-05-02', 'Other')]));
    const next = applyRemote(mine, base, theirs);
    expect(next.transactions.map((t) => t.category)).toEqual(['Drinks', 'Going Out']);
  });

  it("replaces categories with the other device's, unless they changed here too", () => {
    const theirs = toChunks({ ...saved, categories: ['Only'] });
    expect(applyRemote(saved, base, theirs).categories).toEqual(['Only']);
    const mine = { ...saved, categories: [...saved.categories, 'Mine'] };
    expect(applyRemote(mine, base, theirs).categories).toEqual([...mine.categories, 'Only']);
  });
});

describe('forecast sync', () => {
  const forecast = { '2026-07': { Income: 200000, Holidays: 50000 } };

  it('round-trips through chunks', () => {
    expect(fromChunks(toChunks(data([tx('a', '2026-05-01')], { forecast })))!.forecast).toEqual(forecast);
  });

  it('merges figures from both devices, keeping this one where both set the same cell', () => {
    const local = data([tx('a', '2026-05-01')], { forecast: { '2026-07': { Holidays: 1 } } });
    const remote = data([], { forecast: { '2026-07': { Holidays: 2, Income: 3 }, '2026-08': { Income: 4 } } });
    expect(mergeData(local, remote).forecast).toEqual({ '2026-07': { Holidays: 1, Income: 3 }, '2026-08': { Income: 4 } });
  });

  it("takes another device's newer figures", () => {
    const saved = data([tx('a', '2026-05-01')], { forecast });
    const theirs = toChunks({ ...saved, forecast: { '2026-07': { Income: 1 } } });
    expect(applyRemote(saved, toChunks(saved), theirs).forecast).toEqual({ '2026-07': { Income: 1 } });
  });
});

describe('category type sync', () => {
  it('round-trips and combines essential categories from both devices', () => {
    const saved = data([tx('a', '2026-05-01')], { essential: ['Rent & bills'] });
    expect(fromChunks(toChunks(saved))!.essential).toEqual(['Rent & bills']);
    expect(mergeData(data([tx('b', '2026-05-02')], { essential: ['Living/Food'] }), saved).essential).toEqual(['Living/Food', 'Rent & bills']);
  });
});

describe('opening balance sync', () => {
  it('round-trips and reaches a device that has none', () => {
    const saved = data([tx('a', '2026-05-01')], { openingBalance: 265843 });
    expect(fromChunks(toChunks(saved))!.openingBalance).toBe(265843);
    expect(mergeData(data([tx('b', '2026-05-02')]), saved).openingBalance).toBe(265843);
  });
});

describe('latestByTag', () => {
  it('keeps the newest event per tag and ignores other apps', () => {
    const e = (d: string, created_at: number) => ({ id: d + created_at, pubkey: '', sig: '', kind: 30078, content: '', created_at, tags: [['d', d]] });
    const latest = latestByTag([e('personal-budget:settings', 1), e('personal-budget:settings', 3), e('other-app', 5)]);
    expect([...latest.keys()]).toEqual(['personal-budget:settings']);
    expect(latest.get('personal-budget:settings')!.created_at).toBe(3);
  });
});

describe('keySigner', () => {
  it('encrypts so only the same key can read it', async () => {
    const signer = keySigner(newSecretKey().secret);
    const other = keySigner(newSecretKey().secret);
    const payload = await signer.encrypt('hello');
    expect(payload).not.toContain('hello');
    expect(await signer.decrypt(payload)).toBe('hello');
    await expect(other.decrypt(payload)).rejects.toThrow();
  });
});
