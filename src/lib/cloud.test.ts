import { describe, expect, it } from 'vitest';
import { CloudSync, type ChunkRow, type ChunkStore } from './cloud';
import { emptyData } from './store';
import { applyRemote } from './sync';
import type { BudgetData, Transaction } from './types';

function tx(id: string, date: string, category: string | null = null): Transaction {
  return { id, date, description: id, merchant: id, amount: -100, balance: null, category, categorySource: category ? 'manual' : null };
}

function data(transactions: Transaction[]): BudgetData {
  return { ...emptyData(), transactions };
}

/** A table that stamps each saved row with a later time, like the database trigger. */
function fakeTable() {
  const rows = new Map<string, ChunkRow>();
  let clock = 0;
  const stamp = () => new Date(Date.UTC(2026, 9, 27, 12, 0, 0, ++clock)).toISOString();
  const store: ChunkStore = {
    async fetch(since) {
      return [...rows.values()].filter((r) => !since || r.updated_at > since).sort((a, b) => a.updated_at.localeCompare(b.updated_at));
    },
    async upsert(list) {
      return list.map(({ d, body }) => {
        const row = { d, body, updated_at: stamp() };
        rows.set(d, row);
        return row;
      });
    },
  };
  return { rows, store };
}

/** A device: its sync, and its data with other devices' saves applied as they arrive. */
function device(store: ChunkStore, start: BudgetData) {
  const me = { data: start, sync: null as unknown as CloudSync };
  me.sync = new CloudSync(store, (incoming, base) => {
    me.data = applyRemote(me.data, base, incoming);
  });
  return me;
}

describe('CloudSync', () => {
  it('uploads every part the first time, then only what changed', async () => {
    const { rows, store } = fakeTable();
    const sync = new CloudSync(store, () => {});
    expect(await sync.load()).toBeNull();
    const first = data([tx('a', '2026-09-01'), tx('b', '2026-10-01')]);
    expect(await sync.save(first)).toBe(3);
    expect([...rows.keys()].sort()).toEqual(['personal-budget:settings', 'personal-budget:tx:2026-09:000', 'personal-budget:tx:2026-10:000']);
    expect(sync.hasChanges(first)).toBe(false);
    expect(await sync.save({ ...first, transactions: [...first.transactions, tx('c', '2026-10-02')] })).toBe(1);
  });

  it('loads what another device saved', async () => {
    const { store } = fakeTable();
    const saved = data([tx('a', '2026-09-01', 'Going Out')]);
    await new CloudSync(store, () => {}).save(saved);
    expect(await new CloudSync(store, () => {}).load()).toEqual(saved);
  });

  it("picks up another device's save on refresh, keeping this device's own unsaved change", async () => {
    const { store } = fakeTable();
    const start = data([tx('a', '2026-09-01'), tx('b', '2026-09-02')]);
    const phone = device(store, start);
    await phone.sync.load();
    await phone.sync.save(start);
    const laptop = device(store, start);
    await laptop.sync.load();

    laptop.data = { ...start, transactions: [tx('a', '2026-09-01', 'Going Out'), start.transactions[1]] };
    await laptop.sync.save(laptop.data);
    phone.data = { ...phone.data, transactions: [phone.data.transactions[0], tx('b', '2026-09-02', 'Holidays')] };

    expect(await phone.sync.refresh()).toBe(true);
    expect(phone.data.transactions.map((t) => t.category)).toEqual(['Going Out', 'Holidays']);
    expect(await phone.sync.refresh()).toBe(false);
  });

  it("applies another device's save instead of overwriting it, then sends both", async () => {
    const { rows, store } = fakeTable();
    const start = data([tx('a', '2026-09-01')]);
    const phone = device(store, start);
    await phone.sync.load();
    await phone.sync.save(start);
    const laptop = device(store, start);
    await laptop.sync.load();

    await laptop.sync.save({ ...start, transactions: [...start.transactions, tx('b', '2026-09-03')] });
    phone.data = { ...start, transactions: [...start.transactions, tx('c', '2026-09-05')] };
    expect(await phone.sync.save(phone.data)).toBe(0);
    expect(phone.data.transactions.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(await phone.sync.save(phone.data)).toBe(1);
    expect(JSON.parse(rows.get('personal-budget:tx:2026-09:000')!.body).transactions).toHaveLength(3);
  });

  it('empties a month that no longer has transactions, and leaves it out when loading', async () => {
    const { rows, store } = fakeTable();
    const sync = new CloudSync(store, () => {});
    await sync.load();
    await sync.save(data([tx('a', '2026-09-01'), tx('b', '2026-10-01')]));
    await sync.save(data([tx('b', '2026-10-01')]));
    expect(JSON.parse(rows.get('personal-budget:tx:2026-09:000')!.body)).toEqual({ transactions: [] });
    expect((await new CloudSync(store, () => {}).load())!.transactions.map((t) => t.id)).toEqual(['b']);
  });
});
