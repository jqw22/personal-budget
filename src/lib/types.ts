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
  /** The user's own note. The imported description is never changed, so duplicates and rules still match. */
  note?: string;
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

export interface BudgetData {
  transactions: Transaction[];
  rules: Rule[];
  categories: string[];
  /** The user's groups (such as Income or Essential), in the order the summary shows them. The code calls them types. */
  types?: string[];
  /** Groups whose categories are money in (Income kind) rather than spending. */
  incomeGroups?: string[];
  /** Categories put away: kept, with their transactions, but left out of tagging lists, and out of the summary in years they have nothing. */
  archivedCategories?: string[];
  /** Each category's group, by category name. */
  categoryTypes?: Record<string, string>;
  /** Types left out of the forecast: their categories' forecast starts at £0 instead of the average. */
  noForecastTypes?: string[];
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
  /** Year budgets typed in by the user, in pence, by year ("2026") then row ("Income", "Transfers" or a spending category). */
  budgets?: Record<string, Record<string, number>>;
  /** Balance before the first transaction, in pence, typed in by the user for the running balance in downloads. */
  openingBalance?: number;
  /**
   * Categories the user removed or renamed away, so that combining with another device or the
   * relays doesn't bring them back. Adding a category again takes it off this list.
   */
  deletedCategories?: string[];
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

/** The groups budgets saved before version 4 had, in the order the summary shows them. A new budget starts with none. */
export const DEFAULT_TYPES = ['Income', 'Essential', 'Living', 'Discretionary'];
/** The Income-kind groups a new budget starts with. */
export const DEFAULT_INCOME_GROUPS = ['Income'];
/** Which group each starting category is in, where it isn't the last Spending group. */
export const DEFAULT_CATEGORY_TYPES: Record<string, string> = { Income: 'Income', Transfers: 'Income' };

/** The user's groups, in their order. Data saved before groups were the user's own has the old defaults. */
export function typeList(data: Pick<BudgetData, 'types'>): string[] {
  return data.types ?? DEFAULT_TYPES;
}

/** Whether a group's categories are money in rather than spending. */
export function isIncomeType(data: Pick<BudgetData, 'types' | 'incomeGroups'>, type: string): boolean {
  return (data.incomeGroups ?? DEFAULT_INCOME_GROUPS).includes(type);
}

/** The Income-kind groups, in order. */
export function incomeTypes(data: Pick<BudgetData, 'types' | 'incomeGroups'>): string[] {
  return typeList(data).filter((t) => isIncomeType(data, t));
}

/** The Spending-kind groups, in order. */
export function spendingTypes(data: Pick<BudgetData, 'types' | 'incomeGroups'>): string[] {
  return typeList(data).filter((t) => !isIncomeType(data, t));
}

/**
 * A category's group; one never given a group (or whose group was removed) counts as the last
 * Spending group.
 */
export function categoryType(data: Pick<BudgetData, 'types' | 'categoryTypes' | 'incomeGroups'>, category: string): string {
  const types = typeList(data);
  // Income and Transfers start in the Income group, even before being given one.
  const type = data.categoryTypes?.[category] ?? DEFAULT_CATEGORY_TYPES[category];
  if (type && types.includes(type)) return type;
  const spending = spendingTypes(data);
  return spending.at(-1) ?? types[types.length - 1];
}

/** Every category in an Income group: money in, left out of spending. */
export function incomeCategories(data: Pick<BudgetData, 'categories' | 'types' | 'categoryTypes' | 'incomeGroups'>): string[] {
  return data.categories.filter((c) => isIncomeType(data, categoryType(data, c)));
}

/** Spending categories whose type is left out of the forecast. */
export function unforecastCategories(data: Pick<BudgetData, 'types' | 'categoryTypes' | 'noForecastTypes' | 'incomeGroups'>, categories: string[]): string[] {
  const off = data.noForecastTypes ?? [];
  return off.length ? categories.filter((c) => off.includes(categoryType(data, c))) : [];
}
