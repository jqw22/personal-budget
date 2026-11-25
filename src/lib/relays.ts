import { SimplePool, type Event } from 'nostr-tools';
import type { Signer } from './nostr';
import { fromChunks, KIND, latestByTag, toChunks } from './sync';
import type { BudgetData } from './types';

export const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];

/** Plaintext of a chunk that has been emptied, so a relay's old copy is replaced with nothing. */
const EMPTY = JSON.stringify({ transactions: [] });

/** Called with chunks another device saved, and what relays had for them before. */
export type RemoteChanges = (incoming: Map<string, string>, base: Map<string, string>) => void;

/** How one relay took the most recent save: how many records it accepted, and why it turned any down. */
export interface SaveResult {
  accepted: number;
  failed: number;
  error?: string;
}

/** What one relay serves back, compared with the latest copy of each record this device knows about. */
export interface RelayCheck {
  url: string;
  connected: boolean;
  /** Records this device knows about. */
  expected: number;
  /** How many of them the relay sent back, in any version. */
  held: number;
  /** How many of those are an older version than the latest. */
  behind: number;
}

/** Called each time a relay answers a save. */
export type SaveResults = (results: Map<string, SaveResult>) => void;

/**
 * Keeps an encrypted copy of the budget on Nostr relays. Remembers what the
 * relays already have, so saving only uploads the parts that changed, and
 * listens for saves from the user's other devices.
 */
export class RelaySync {
  private pool = new SimplePool();
  /** Plaintext of each chunk as the relays have it. */
  private saved = new Map<string, string>();
  /** When each chunk was last saved, from any device. */
  private savedAt = new Map<string, number>();
  private lastCreatedAt = 0;
  /** Relay work runs one step at a time, so the same change is never sent or applied twice. */
  private queue: Promise<unknown> = Promise.resolve();
  private subscription: { close: () => void } | null = null;
  /** How each relay took the most recent save. */
  private results = new Map<string, SaveResult>();

  constructor(
    private signer: Signer,
    private relays: string[],
    private onRemote: RemoteChanges,
    private onSaveResults: SaveResults = () => {},
  ) {}

  /** Records one relay's answer to one record of the current save. */
  private record(url: string, outcome: PromiseSettledResult<string>) {
    const was = this.results.get(url) ?? { accepted: 0, failed: 0 };
    this.results.set(
      url,
      outcome.status === 'fulfilled'
        ? { ...was, accepted: was.accepted + 1 }
        : { ...was, failed: was.failed + 1, error: String(outcome.reason instanceof Error ? outcome.reason.message : outcome.reason) },
    );
    this.onSaveResults(new Map(this.results));
  }

  /**
   * Asks each relay on its own for the user's records, so it's clear which relays are storing the
   * data and serving it back. A relay that can't be reached in time shows as not connected.
   */
  check(): Promise<RelayCheck[]> {
    const expected = new Map(this.savedAt);
    return Promise.all(
      this.relays.map(async (url): Promise<RelayCheck> => {
        const result: RelayCheck = { url, connected: false, expected: expected.size, held: 0, behind: 0 };
        try {
          await this.pool.ensureRelay(url, { connectionTimeout: 5000 });
        } catch {
          return result;
        }
        result.connected = true;
        const events = await this.pool.querySync([url], this.filter(), { maxWait: 6000 });
        for (const [d, event] of latestByTag(events)) {
          const latest = expected.get(d);
          if (latest === undefined) continue;
          result.held++;
          if (event.created_at < latest) result.behind++;
        }
        return result;
      }),
    );
  }

  private filter(since?: number) {
    return { kinds: [KIND], authors: [this.signer.pubkey], ...(since ? { since } : {}) };
  }

  private enqueue<T>(step: () => Promise<T>): Promise<T> {
    const run = this.queue.then(step);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Decrypts events newer than what we have, returning their plaintext by tag. */
  private async read(events: Event[]): Promise<Map<string, string>> {
    const chunks = new Map<string, string>();
    for (const [d, event] of latestByTag(events)) {
      if (event.created_at <= (this.savedAt.get(d) ?? 0)) continue;
      this.savedAt.set(d, event.created_at);
      this.lastCreatedAt = Math.max(this.lastCreatedAt, event.created_at);
      try {
        chunks.set(d, await this.signer.decrypt(event.content));
      } catch {
        // Unreadable chunks (another key, or corrupted) are skipped and overwritten on the next save.
      }
    }
    return chunks;
  }

  /** Downloads and decrypts everything saved, or null when nothing is, then starts listening for other devices. */
  async load(): Promise<BudgetData | null> {
    const events = await this.pool.querySync(this.relays, this.filter(), { maxWait: 6000 });
    const chunks = await this.read(events);
    for (const [d, plaintext] of chunks) this.saved.set(d, plaintext);
    this.subscription = this.pool.subscribe(this.relays, this.filter(this.lastCreatedAt + 1), {
      onevent: (event) => void this.enqueue(() => this.receive([event])),
    });
    return fromChunks(new Map([...chunks].filter(([, plaintext]) => plaintext !== EMPTY)));
  }

  /** Applies chunks other devices saved. Returns whether there were any. */
  private async receive(events: Event[]): Promise<boolean> {
    const incoming = await this.read(events);
    if (incoming.size === 0) return false;
    const base = new Map([...incoming.keys()].filter((d) => this.saved.has(d)).map((d) => [d, this.saved.get(d)!]));
    for (const [d, plaintext] of incoming) this.saved.set(d, plaintext);
    this.onRemote(incoming, base);
    return true;
  }

  /** The chunks that differ from what relays have. */
  private changes(data: BudgetData): [string, string][] {
    const chunks = toChunks(data);
    for (const d of this.saved.keys()) if (!chunks.has(d)) chunks.set(d, EMPTY);
    return [...chunks].filter(([d, plaintext]) => this.saved.get(d) !== plaintext);
  }

  hasChanges(data: BudgetData): boolean {
    return this.changes(data).length > 0;
  }

  /**
   * Encrypts and uploads the parts of `data` that differ from what relays have.
   * If another device saved first, its changes are passed to `onRemote` instead
   * and nothing is sent, so the next save carries both. Returns how many parts were sent.
   */
  save(data: BudgetData): Promise<number> {
    return this.enqueue(async () => {
      const newer = await this.pool.querySync(this.relays, this.filter(this.lastCreatedAt + 1), { maxWait: 4000 });
      if (await this.receive(newer)) return 0;
      let sent = 0;
      const changes = this.changes(data);
      if (changes.length > 0) {
        this.results = new Map(this.relays.map((url) => [url, { accepted: 0, failed: 0 }]));
        this.onSaveResults(new Map(this.results));
      }
      for (const [d, plaintext] of changes) {
        // Replaceable events keep the newest by created_at, so never reuse a second.
        this.lastCreatedAt = Math.max(Math.floor(Date.now() / 1000), this.lastCreatedAt + 1);
        const event = await this.signer.sign({
          kind: KIND,
          created_at: this.lastCreatedAt,
          tags: [['d', d]],
          content: await this.signer.encrypt(plaintext),
        });
        // Mark it ours before it can echo back through the subscription.
        this.savedAt.set(d, event.created_at);
        // One relay at a time, so each relay's answer is known.
        const answers = this.relays.map((url) => {
          const answer = this.pool.publish([url], event, { maxWait: 6000 })[0];
          void Promise.allSettled([answer]).then(([outcome]) => this.record(url, outcome));
          return answer;
        });
        await Promise.any(answers).catch(() => {
          throw new Error("Couldn't reach any relay to save your data.");
        });
        this.saved.set(d, plaintext);
        sent++;
      }
      return sent;
    });
  }

  close() {
    this.subscription?.close();
    this.pool.destroy();
  }
}
