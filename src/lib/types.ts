export interface Transaction {
  /** Stable id derived from the row contents, used to skip duplicates on re-import. */
  id: string;
  /** Posting date as YYYY-MM-DD. */
  date: string;
  description: string;
  /** Short, normalised payee name used for matching rules. */
  merchant: string;
  /** Amount in pence: negative for money out, positive for money in. */
  amount: number;
  /** Running balance in pence after this transaction, when the bank provides one. */
  balance: number | null;
  category: string | null;
  /** How the category was set: by hand, or by a merchant rule. */
  categorySource: 'manual' | 'rule' | null;
}

export interface Rule {
  id: string;
  /** Matched case-insensitively against the transaction's merchant name. */
  match: string;
  category: string;
}

export interface BudgetData {
  transactions: Transaction[];
  rules: Rule[];
  categories: string[];
}

export const DEFAULT_CATEGORIES = [
  'Groceries',
  'Eating out',
  'Drinks',
  'Transport',
  'Travel',
  'Shopping',
  'Health & beauty',
  'Rent & bills',
  'Entertainment',
  'Gifts & donations',
  'Fees',
  'Transfers',
  'Income',
  'Other',
];
