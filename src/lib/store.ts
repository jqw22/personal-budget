import { applyRules } from './rules';
import { DEFAULT_CATEGORIES, type BudgetData, type Transaction } from './types';

const VERSION = 2;

/** Default categories renamed in version 2. */
const RENAMED_IN_V2: Record<string, string> = {
  Groceries: 'Living/Food',
  Travel: 'Holidays',
  'Eating out': 'Going Out',
  Fees: 'Subscriptions',
};

// This device's copy. When signed in with Nostr, an encrypted copy is also kept on relays (see useSync).
const KEY = 'personal-budget:v1';

export function emptyData(): BudgetData {
  return { transactions: [], rules: [], categories: [...DEFAULT_CATEGORIES], version: VERSION };
}

/** Categories in A to Z order, for showing in lists and dropdowns. */
export function sortedCategories(categories: string[]): string[] {
  return [...categories].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

/** Renames a category everywhere it's used: the category list, rules and tagged transactions. */
export function renameCategory(data: BudgetData, from: string, to: string): BudgetData {
  const rename = (c: string) => (c === from ? to : c);
  return {
    ...data,
    categories: [...new Set(data.categories.map(rename))],
    rules: data.rules.map((r) => ({ ...r, category: rename(r.category) })),
    transactions: data.transactions.map((t) => (t.category === from ? { ...t, category: to } : t)),
  };
}

/** Upgrades data saved by an older version of the app. */
export function migrate(data: BudgetData): BudgetData {
  let next = data;
  if ((next.version ?? 1) < 2) {
    for (const [from, to] of Object.entries(RENAMED_IN_V2)) next = renameCategory(next, from, to);
  }
  return { ...next, version: VERSION };
}

export function loadData(): BudgetData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyData();
    return migrate({ ...emptyData(), version: 1, ...JSON.parse(raw) });
  } catch {
    return emptyData();
  }
}

/**
 * Roughly how much a browser lets one website keep. Most allow about 5 million
 * characters, so this is a cautious guess rather than an exact limit.
 */
export const STORAGE_LIMIT = 5_000_000;

/** Saves to this browser. Returns the share of the storage limit used, or null if the browser refused to save. */
export function saveData(data: BudgetData): number | null {
  const json = JSON.stringify(data);
  try {
    localStorage.setItem(KEY, json);
    return json.length / STORAGE_LIMIT;
  } catch {
    return null;
  }
}

/** Adds new transactions, skipping any already saved, and tags them with existing rules. */
export function mergeTransactions(data: BudgetData, incoming: Transaction[]): { data: BudgetData; added: number } {
  const known = new Set(data.transactions.map((t) => t.id));
  const fresh = incoming.filter((t) => !known.has(t.id));
  const transactions = [...data.transactions, ...applyRules(fresh, data.rules)].sort(
    (a, b) => a.date.localeCompare(b.date),
  );
  return { data: { ...data, transactions }, added: fresh.length };
}
