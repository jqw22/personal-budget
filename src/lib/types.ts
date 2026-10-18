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
  /** Spending categories that are essential. Every other spending category is discretionary. */
  essential?: string[];
  /**
   * Forecast amounts typed in by the user, in pence, by month ("2026-07") then
   * row ("Income" or a spending category). Rows left out use the monthly average.
   */
  forecast?: Record<string, Record<string, number>>;
  /** Balance before the first transaction, in pence, typed in by the user for the running balance in downloads. */
  openingBalance?: number;
  /** Data format version, so saved data can be upgraded when defaults change. */
  version?: number;
}

export const DEFAULT_CATEGORIES = [
  'Living/Food',
  'Going Out',
  'Drinks',
  'Transport',
  'Holidays',
  'Shopping',
  'Health & beauty',
  'Rent & bills',
  'Entertainment',
  'Gifts & donations',
  'Subscriptions',
  'Transfers',
  'Income',
  'Other',
];
