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
  /**
   * When split by hand, the parts it was divided into, each with its own category. The parts add up
   * to `amount` exactly and share its sign; the imported fields above are never changed by a split.
   */
  splits?: Split[];
}

export interface Split {
  /** In pence, with the same sign as the transaction's amount. */
  amount: number;
  category: string;
}

export interface Rule {
  id: string;
  /** Matched case-insensitively against the transaction's merchant name. */
  match: string;
  category: string;
}

export interface Goal {
  id: string;
  /** In the user's own words, e.g. "Save £3,000 for a holiday by June". */
  text: string;
}

/** The last review Claude wrote, kept so it's still there next time. */
export interface Insight {
  /** When it was written, as an ISO timestamp. */
  at: string;
  /** Markdown. */
  text: string;
  /** The user's replies to the review and Claude's answers, oldest first. */
  followUps?: { question: string; answer: string }[];
}

export interface BudgetData {
  transactions: Transaction[];
  rules: Rule[];
  categories: string[];
  /** The user's spending types (such as Essential), in the order the summary shows them. */
  types?: string[];
  /** Each spending category's type, by category name. */
  categoryTypes?: Record<string, string>;
  /** Types the user removed, so syncing with another device doesn't bring them back. */
  deletedTypes?: string[];
  /** Before version 4: essential categories. Only read when upgrading. */
  essential?: string[];
  /** Before version 4: living categories. Only read when upgrading. */
  living?: string[];
  /**
   * Forecast amounts typed in by the user, in pence, by month ("2026-07") then
   * row ("Income" or a spending category). Rows left out use the monthly average.
   */
  forecast?: Record<string, Record<string, number>>;
  /** Balance before the first transaction, in pence, typed in by the user for the running balance in downloads. */
  openingBalance?: number;
  /** Financial goals the insights review checks progress against. */
  goals?: Goal[];
  /** The user's own Anthropic API key, for the insights review. */
  anthropicKey?: string;
  /**
   * Categories the user removed or renamed away, so that combining with another device or the
   * relays doesn't bring them back. Adding a category again takes it off this list.
   */
  deletedCategories?: string[];
  insight?: Insight;
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

/** The spending types a new budget starts with, in the order the summary shows them. */
export const DEFAULT_TYPES = ['Essential', 'Living', 'Discretionary'];

/** The user's spending types, in their order. */
export function typeList(data: Pick<BudgetData, 'types'>): string[] {
  return data.types?.length ? data.types : DEFAULT_TYPES;
}

/** A spending category's type; one never given a type (or whose type was removed) counts as the last type. */
export function categoryType(data: Pick<BudgetData, 'types' | 'categoryTypes'>, category: string): string {
  const types = typeList(data);
  const type = data.categoryTypes?.[category];
  return type && types.includes(type) ? type : types[types.length - 1];
}
