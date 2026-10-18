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

// Saved in this browser for now. Encrypted storage on Nostr relays replaces this later.
const KEY = 'personal-budget:v1';

export function emptyData(): BudgetData {
  return { transactions: [], rules: [], categories: [...DEFAULT_CATEGORIES], version: VERSION };
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

export function saveData(data: BudgetData): void {
  localStorage.setItem(KEY, JSON.stringify(data));
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
