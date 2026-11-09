import type { Event } from 'nostr-tools';
import { withSplit } from './splits';
import { applyRules } from './rules';
import { migrate } from './store';
import { DEFAULT_CATEGORIES, type BudgetData, type Rule, type Transaction } from './types';

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
  return JSON.stringify({ version: data.version, categories: data.categories, essential: data.essential, rules: data.rules, forecast: data.forecast, openingBalance: data.openingBalance, goals: data.goals, anthropicKey: data.anthropicKey, insight: data.insight, deletedCategories: data.deletedCategories });
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
  const { version, categories, essential, rules, forecast, openingBalance, goals, anthropicKey, insight, deletedCategories } = settings
    ? JSON.parse(settings)
    : { version: undefined, categories: [], rules: [] };
  return migrate({
    version,
    categories,
    ...(essential ? { essential } : {}),
    rules,
    ...(forecast ? { forecast } : {}),
    ...(openingBalance !== undefined ? { openingBalance } : {}),
    ...(goals ? { goals } : {}),
    ...(anthropicKey ? { anthropicKey } : {}),
    ...(insight ? { insight } : {}),
    ...(deletedCategories?.length ? { deletedCategories } : {}),
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

/** Keeps whichever copy carries more of the user's own work: a split beats a hand-picked category, which beats a rule's. */
function pick(local: Transaction, remote: Transaction): Transaction {
  const rank = (t: Transaction) => (t.splits?.length ? 3 : t.categorySource === 'manual' ? 2 : t.category ? 1 : 0);
  return rank(remote) > rank(local) ? remote : local;
}

function isUntouched(data: BudgetData): boolean {
  return (
    data.transactions.length === 0 &&
    data.rules.length === 0 &&
    data.categories.join('\n') === DEFAULT_CATEGORIES.join('\n')
  );
}

/**
 * Every category, rule and goal from both sides, except categories either side deleted; this
 * device's rule wins where both match the same merchant, and the newer insights review is kept.
 */
function mergeSettings(local: BudgetData, remote: BudgetData): BudgetData {
  const deleted = new Set([...(local.deletedCategories ?? []), ...(remote.deletedCategories ?? [])]);
  const kept = (c: string) => !deleted.has(c);
  const rules: Rule[] = [...local.rules];
  const known = new Set(local.rules.map((r) => r.match.toUpperCase()));
  for (const r of remote.rules) if (!known.has(r.match.toUpperCase())) rules.push(r);
  const goalIds = new Set((local.goals ?? []).map((g) => g.id));
  const goals = [...(local.goals ?? []), ...(remote.goals ?? []).filter((g) => !goalIds.has(g.id))];
  const insight = !local.insight || (remote.insight && remote.insight.at > local.insight.at) ? remote.insight : local.insight;
  return {
    ...local,
    categories: [...new Set([...local.categories, ...remote.categories])].filter(kept),
    essential: [...new Set([...(local.essential ?? []), ...(remote.essential ?? [])])].filter(kept),
    rules: rules.filter((r) => kept(r.category)),
    deletedCategories: [...deleted],
    forecast: mergeForecast(local.forecast, remote.forecast),
    openingBalance: local.openingBalance ?? remote.openingBalance,
    goals: local.goals || remote.goals ? goals : undefined,
    anthropicKey: local.anthropicKey ?? remote.anthropicKey,
    insight,
  };
}

/** Both sides' forecast figures; this device's wins where both set the same month and row. */
function mergeForecast(local: BudgetData['forecast'], remote: BudgetData['forecast']): BudgetData['forecast'] {
  if (!local || !remote) return local ?? remote;
  const merged = { ...remote };
  for (const [month, rows] of Object.entries(local)) merged[month] = { ...remote[month], ...rows };
  return merged;
}

/**
 * Combines this device's data with what's saved on relays, keeping one copy of
 * each transaction. Where both copies exist, this device's wins unless only
 * the relay copy was tagged by hand.
 */
export function mergeData(local: BudgetData, remote: BudgetData): BudgetData {
  // A device that has never been used only has the starting categories, so it takes the saved ones
  // as they are rather than adding back defaults the user removed or renamed.
  if (isUntouched(local)) return remote;
  const { categories, essential, rules, forecast, openingBalance, goals, anthropicKey, insight, deletedCategories } = mergeSettings(local, remote);
  const byId = new Map(local.transactions.map((t) => [t.id, t]));
  for (const t of remote.transactions) {
    const mine = byId.get(t.id);
    byId.set(t.id, mine ? pick(mine, t) : t);
  }
  const transactions = untagDeleted([...byId.values()], deletedCategories).sort((a, b) => a.date.localeCompare(b.date));

  return {
    version: Math.max(local.version ?? 1, remote.version ?? 1),
    categories,
    essential,
    rules,
    ...(forecast ? { forecast } : {}),
    ...(openingBalance !== undefined ? { openingBalance } : {}),
    ...(goals ? { goals } : {}),
    ...(anthropicKey ? { anthropicKey } : {}),
    ...(insight ? { insight } : {}),
    ...(deletedCategories?.length ? { deletedCategories } : {}),
    transactions: applyRules(transactions, rules),
  };
}

/** Transactions tagged with a deleted category go back to untagged, and splits using one are undone. */
function untagDeleted(transactions: Transaction[], deleted: string[] | undefined): Transaction[] {
  if (!deleted?.length) return transactions;
  const gone = new Set(deleted);
  return transactions.map((t) =>
    t.splits?.some((p) => gone.has(p.category))
      ? withSplit(t, null)
      : t.category && gone.has(t.category)
        ? { ...t, category: null, categorySource: null }
        : t,
  );
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
    next = unchangedHere
      ? { ...local, categories: remote.categories, essential: remote.essential, rules: remote.rules, forecast: remote.forecast, openingBalance: remote.openingBalance, goals: remote.goals, anthropicKey: remote.anthropicKey, insight: remote.insight, deletedCategories: remote.deletedCategories }
      : mergeSettings(local, remote);
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
  const transactions = untagDeleted([...byId.values()], next.deletedCategories).sort((a, b) => a.date.localeCompare(b.date));
  return { ...next, transactions: applyRules(transactions, next.rules) };
}
