import type { Split, Transaction } from './types';

/** Whether a transaction has a category, either its own or one on every part of a split. */
export function isTagged(t: Transaction): boolean {
  return Boolean(t.category) || Boolean(t.splits?.length);
}

/**
 * Each split transaction as its parts, for adding up by category. Every part keeps the original's
 * date, merchant and description; only the last part carries the bank's balance, so running
 * totals still reach it. Parts add up to the original, so balances work out the same either way.
 */
export function expandSplits(transactions: Transaction[]): Transaction[] {
  if (!transactions.some((t) => t.splits?.length)) return transactions;
  return transactions.flatMap((t) =>
    t.splits?.length
      ? t.splits.map((p, i, parts) => ({
          ...t,
          id: `${t.id}#${i + 1}`,
          amount: p.amount,
          balance: i === parts.length - 1 ? t.balance : null,
          category: p.category,
          categorySource: 'manual' as const,
          splits: undefined,
        }))
      : [t],
  );
}

/** Why these parts can't split this transaction, or null when they can. */
export function splitProblem(t: Transaction, parts: Split[]): string | null {
  if (parts.length < 2) return 'Split into at least two parts.';
  if (parts.some((p) => !p.category)) return 'Choose a category for each part.';
  if (parts.some((p) => p.amount === 0 || Math.sign(p.amount) !== Math.sign(t.amount))) return 'Each part must be more than £0.';
  if (parts.reduce((total, p) => total + p.amount, 0) !== t.amount) return 'The parts must add up to the whole amount.';
  return null;
}

/** The transaction split into `parts`, or with any split removed when `parts` is null. Imported fields stay as they were. */
export function withSplit(t: Transaction, parts: Split[] | null): Transaction {
  if (!parts) {
    const { splits: _, ...rest } = t;
    return { ...rest, category: null, categorySource: null };
  }
  return { ...t, category: null, categorySource: 'manual', splits: parts };
}

/** The part amounts of a transaction that fall in `category`, or the whole amount when it isn't split. */
export function amountIn(t: Transaction, category: string | null): number {
  if (!t.splits?.length) return t.amount;
  return t.splits.filter((p) => p.category === category).reduce((total, p) => total + p.amount, 0);
}
