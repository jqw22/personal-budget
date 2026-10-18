import { applyRules } from './rules';
import { DEFAULT_CATEGORIES, type BudgetData, type Transaction } from './types';

// Saved in this browser for now. Encrypted storage on Nostr relays replaces this later.
const KEY = 'personal-budget:v1';

export function emptyData(): BudgetData {
  return { transactions: [], rules: [], categories: [...DEFAULT_CATEGORIES] };
}

export function loadData(): BudgetData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyData();
    return { ...emptyData(), ...JSON.parse(raw) };
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
