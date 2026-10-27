import { fromChunks, toChunks } from './sync';
import type { RemoteChanges } from './relays';
import type { BudgetData } from './types';

/** A saved part of the budget, as a row of the budget_chunks table. */
export interface ChunkRow {
  d: string;
  body: string;
  updated_at: string;
}

/** Where the rows are kept: Supabase in the app, a stand-in in tests. */
export interface ChunkStore {
  /** The signed-in user's rows, or only those changed after `since`. */
  fetch(since?: string): Promise<ChunkRow[]>;
  /** Saves rows and returns them with the time the database gave each. */
  upsert(rows: { d: string; body: string }[]): Promise<ChunkRow[]>;
}

/** Body of a part that has been emptied, so the saved copy is replaced with nothing. */
const EMPTY = JSON.stringify({ transactions: [] });

/**
 * Keeps a copy of the budget in Supabase, as the same parts the relays get.
 * Remembers what the database already has, so saving only uploads the parts
 * that changed, and picks up saves from the user's other devices when asked
 * to refresh.
 */
export class CloudSync {
  /** Body of each part as the database has it. */
  private saved = new Map<string, string>();
  /** When each part was last saved, from any device. */
  private savedAt = new Map<string, string>();
  private lastSeen: string | undefined;
  /** Database work runs one step at a time, so the same change is never sent or applied twice. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private store: ChunkStore,
    private onRemote: RemoteChanges,
  ) {}

  private enqueue<T>(step: () => Promise<T>): Promise<T> {
    const run = this.queue.then(step);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Notes rows as seen and returns the ones another device saved. */
  private read(rows: ChunkRow[]): Map<string, string> {
    const chunks = new Map<string, string>();
    for (const row of rows) {
      if (!this.lastSeen || row.updated_at > this.lastSeen) this.lastSeen = row.updated_at;
      if (row.updated_at <= (this.savedAt.get(row.d) ?? '')) continue;
      this.savedAt.set(row.d, row.updated_at);
      chunks.set(row.d, row.body);
    }
    return chunks;
  }

  /** Downloads everything saved, or null when nothing is. */
  load(): Promise<BudgetData | null> {
    return this.enqueue(async () => {
      const chunks = this.read(await this.store.fetch());
      for (const [d, body] of chunks) this.saved.set(d, body);
      return fromChunks(new Map([...chunks].filter(([, body]) => body !== EMPTY)));
    });
  }

  /** Applies parts other devices saved. Returns whether there were any. */
  private async receive(): Promise<boolean> {
    const incoming = this.read(await this.store.fetch(this.lastSeen));
    if (incoming.size === 0) return false;
    const base = new Map([...incoming.keys()].filter((d) => this.saved.has(d)).map((d) => [d, this.saved.get(d)!]));
    for (const [d, body] of incoming) this.saved.set(d, body);
    this.onRemote(incoming, base);
    return true;
  }

  /** Fetches and applies anything another device has saved since the last look. */
  refresh(): Promise<boolean> {
    return this.enqueue(() => this.receive());
  }

  /** The parts that differ from what the database has. */
  private changes(data: BudgetData): [string, string][] {
    const chunks = toChunks(data);
    for (const d of this.saved.keys()) if (!chunks.has(d)) chunks.set(d, EMPTY);
    return [...chunks].filter(([d, body]) => this.saved.get(d) !== body);
  }

  hasChanges(data: BudgetData): boolean {
    return this.changes(data).length > 0;
  }

  /**
   * Uploads the parts of `data` that differ from what the database has. If
   * another device saved first, its changes are passed to `onRemote` instead
   * and nothing is sent, so the next save carries both. Returns how many parts were sent.
   */
  save(data: BudgetData): Promise<number> {
    return this.enqueue(async () => {
      if (await this.receive()) return 0;
      const rows = this.changes(data).map(([d, body]) => ({ d, body }));
      if (rows.length === 0) return 0;
      for (const row of await this.store.upsert(rows)) {
        this.saved.set(row.d, row.body);
        // Not counted towards lastSeen, so a save another device made meanwhile is still fetched next time.
        this.savedAt.set(row.d, row.updated_at);
      }
      return rows.length;
    });
  }

}
