import type { Event } from 'nostr-tools';
import { applyRules } from './rules';
import { migrate } from './store';
import type { BudgetData, Rule, Transaction } from './types';

/** NIP-78 application data: addressable events, one per `d` tag, each replacing the last. */
export const KIND = 30078;
const PREFIX = 'personal-budget:';
const SETTINGS = `${PREFIX}settings`;

/**
 * Most a single event holds before a month is split into parts. NIP-44 can
 * encrypt up to 64KB, but some relays refuse events much bigger than this.
 */
const PART_BYTES = 20000;

function settingsJson(data: BudgetData): string {
  return JSON.stringify({ version: data.version, categories: data.categories, rules: data.rules });
}

export function isOurs(d: string): boolean {
  return d.startsWith(PREFIX);
}

/**
 * Splits budget data into the plaintext of each event: one for categories and
 * rules, and one or more per month of transactions, so a change only
 * re-uploads the months it touches.
 */
export function toChunks(data: BudgetData): Map<string, string> {
  const chunks = new Map<string, string>();
  chunks.set(SETTINGS, settingsJson(data));

  const byMonth = new Map<string, Transaction[]>();
  for (const t of data.transactions) {
    const month = t.date.slice(0, 7);
    byMonth.set(month, [...(byMonth.get(month) ?? []), t]);
  }
  for (const [month, transactions] of byMonth) {
    let part: Transaction[] = [];
    let size = 0;
    let index = 0;
    const flush = () => {
      chunks.set(`${PREFIX}tx:${month}:${String(index++).padStart(3, '0')}`, JSON.stringify({ transactions: part }));
      part = [];
      size = 0;
    };
    for (const t of transactions) {
      const bytes = JSON.stringify(t).length + 1;
      if (part.length > 0 && size + bytes > PART_BYTES) flush();
      part.push(t);
      size += bytes;
    }
    flush();
  }
  return chunks;
}

/** Rebuilds budget data from decrypted chunks. Returns null when there's nothing saved. */
export function fromChunks(chunks: Map<string, string>): BudgetData | null {
  const settings = chunks.get(SETTINGS);
  const transactions: Transaction[] = [];
  // Parts are named in order, so sorting by tag keeps each month's transactions in statement order.
  for (const [d, plaintext] of [...chunks].sort(([a], [b]) => a.localeCompare(b))) {
    if (d === SETTINGS) continue;
    transactions.push(...(JSON.parse(plaintext).transactions as Transaction[]));
  }
  if (!settings && transactions.length === 0) return null;
  const { version, categories, rules } = settings ? JSON.parse(settings) : { version: undefined, categories: [], rules: [] };
  return migrate({
    version,
    categories,
    rules,
    transactions: dedupe(transactions).sort((a, b) => a.date.localeCompare(b.date)),
  });
}

function dedupe(transactions: Transaction[]): Transaction[] {
  return [...new Map(transactions.map((t) => [t.id, t])).values()];
}

/** The newest event for each of our `d` tags. */
export function latestByTag(events: Event[]): Map<string, Event> {
  const latest = new Map<string, Event>();
  for (const e of events) {
    const d = e.tags.find((t) => t[0] === 'd')?.[1];
    if (!d || !isOurs(d)) continue;
    const seen = latest.get(d);
    if (!seen || e.created_at > seen.created_at) latest.set(d, e);
  }
  return latest;
}

/** Keeps whichever copy carries more of the user's own work: a hand-picked category beats a rule's. */
function pick(local: Transaction, remote: Transaction): Transaction {
  const rank = (t: Transaction) => (t.categorySource === 'manual' ? 2 : t.category ? 1 : 0);
  return rank(remote) > rank(local) ? remote : local;
}

/** Every category and rule from both sides; this device's rule wins where both match the same merchant. */
function mergeSettings(local: BudgetData, remote: BudgetData): BudgetData {
  const rules: Rule[] = [...local.rules];
  const known = new Set(local.rules.map((r) => r.match.toUpperCase()));
  for (const r of remote.rules) if (!known.has(r.match.toUpperCase())) rules.push(r);
  return { ...local, categories: [...new Set([...local.categories, ...remote.categories])], rules };
}

/**
 * Combines this device's data with what's saved on relays, keeping one copy of
 * each transaction. Where both copies exist, this device's wins unless only
 * the relay copy was tagged by hand.
 */
export function mergeData(local: BudgetData, remote: BudgetData): BudgetData {
  const { categories, rules } = mergeSettings(local, remote);
  const byId = new Map(local.transactions.map((t) => [t.id, t]));
  for (const t of remote.transactions) {
    const mine = byId.get(t.id);
    byId.set(t.id, mine ? pick(mine, t) : t);
  }
  const transactions = [...byId.values()].sort((a, b) => a.date.localeCompare(b.date));

  return {
    version: Math.max(local.version ?? 1, remote.version ?? 1),
    categories,
    rules,
    transactions: applyRules(transactions, rules),
  };
}

/**
 * Applies chunks another device has just saved. Their copy wins, except for
 * anything changed on this device since `base` (what relays had before) and
 * not yet saved, so neither device's latest edit is lost.
 */
export function applyRemote(local: BudgetData, base: Map<string, string>, incoming: Map<string, string>): BudgetData {
  let next = local;
  const settings = incoming.get(SETTINGS);
  if (settings) {
    const remote = { ...local, ...JSON.parse(settings) } as BudgetData;
    const unchangedHere = !base.has(SETTINGS) || base.get(SETTINGS) === settingsJson(local);
    next = unchangedHere ? { ...local, categories: remote.categories, rules: remote.rules } : mergeSettings(local, remote);
  }

  const before = new Map<string, string>();
  for (const [d, plaintext] of base) {
    if (d === SETTINGS) continue;
    for (const t of JSON.parse(plaintext).transactions as Transaction[]) before.set(t.id, JSON.stringify(t));
  }
  const byId = new Map(next.transactions.map((t) => [t.id, t]));
  for (const [d, plaintext] of incoming) {
    if (d === SETTINGS) continue;
    for (const t of JSON.parse(plaintext).transactions as Transaction[]) {
      const mine = byId.get(t.id);
      if (!mine || JSON.stringify(mine) === before.get(t.id)) byId.set(t.id, t);
    }
  }
  const transactions = [...byId.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { ...next, transactions: applyRules(transactions, next.rules) };
}
