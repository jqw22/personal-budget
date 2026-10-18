import type { Rule, Transaction } from './types';

export function findRule(rules: Rule[], merchant: string): Rule | undefined {
  const m = merchant.toUpperCase();
  // Prefer the most specific (longest) match, so "TESCO EXPRESS" beats "TESCO".
  return rules
    .filter((r) => r.match && m.includes(r.match.toUpperCase()))
    .sort((a, b) => b.match.length - a.match.length)[0];
}

/**
 * Applies rules to every transaction that wasn't tagged by hand. Hand-tagged
 * transactions are never changed by a rule.
 */
export function applyRules(transactions: Transaction[], rules: Rule[]): Transaction[] {
  return transactions.map((t) => {
    if (t.categorySource === 'manual') return t;
    const rule = findRule(rules, t.merchant);
    const category = rule?.category ?? null;
    const categorySource = rule ? 'rule' : null;
    if (t.category === category && t.categorySource === categorySource) return t;
    return { ...t, category, categorySource };
  });
}

/** Adds a rule for this merchant, or updates the existing exact-match rule. */
export function upsertRule(rules: Rule[], merchant: string, category: string): Rule[] {
  const existing = rules.find((r) => r.match.toUpperCase() === merchant.toUpperCase());
  if (existing) return rules.map((r) => (r === existing ? { ...r, category } : r));
  return [...rules, { id: crypto.randomUUID(), match: merchant, category }];
}
