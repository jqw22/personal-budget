import { STORAGE_PREFIX } from './env';
import { applyRules } from './rules';
import { withSplit } from './splits';
import { NOT_SPENDING } from './summary';
import { DEFAULT_CATEGORIES, DEFAULT_INCOME_GROUPS, DEFAULT_TYPES, isIncomeType, typeList, type BudgetData, type Transaction } from './types';

const VERSION = 5;

/** Default categories renamed in version 2. */
const RENAMED_IN_V2: Record<string, string> = {
  Groceries: 'Living/Food',
  Travel: 'Holidays',
  'Eating out': 'Going Out',
  Fees: 'Subscriptions',
};

// This device's copy. When signed in with Nostr, an encrypted copy is also kept on relays (see useSync).
const KEY = `${STORAGE_PREFIX}v1`;

export function emptyData(): BudgetData {
  return {
    transactions: [],
    rules: [],
    // A new budget starts empty: the user adds their own groups and categories.
    categories: [],
    types: [],
    incomeGroups: [],
    categoryTypes: {},
    version: VERSION,
  };
}

/** The deleted-categories list without `name`, for when a category of that name is wanted again. */
export function forgetDeleted(deleted: string[] | undefined, name: string): string[] {
  return [...new Set((deleted ?? []).filter((c) => c !== name))];
}

/** Categories in A to Z order, for showing in lists and dropdowns. */
export function sortedCategories(categories: string[]): string[] {
  return [...categories].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

/** Renames a category everywhere it's used: the category list, its type, rules, forecast figures, budgets and tagged transactions. */
export function renameCategory(data: BudgetData, from: string, to: string): BudgetData {
  const rename = (c: string) => (c === from ? to : c);
  const renameRows = (figures: BudgetData['forecast']) =>
    figures
      ? Object.fromEntries(
          Object.entries(figures).map(([key, rows]) => [
            key,
            Object.fromEntries(Object.entries(rows).map(([row, pence]) => [rename(row), pence])),
          ]),
        )
      : undefined;
  const forecast = renameRows(data.forecast);
  const budgets = renameRows(data.budgets);
  return {
    ...data,
    categories: [...new Set(data.categories.map(rename))],
    deletedCategories: forgetDeleted([...(data.deletedCategories ?? []), from], to),
    ...(data.archivedCategories ? { archivedCategories: [...new Set(data.archivedCategories.map(rename))] } : {}),
    ...(data.essential ? { essential: [...new Set(data.essential.map(rename))] } : {}),
    ...(data.categoryTypes
      ? { categoryTypes: Object.fromEntries(Object.entries(data.categoryTypes).map(([c, type]) => [rename(c), type])) }
      : {}),
    ...(forecast ? { forecast } : {}),
    ...(budgets ? { budgets } : {}),
    rules: data.rules.map((r) => ({ ...r, category: rename(r.category) })),
    transactions: data.transactions.map((t) => {
      const next = t.category === from ? { ...t, category: to } : t;
      return next.splits?.some((p) => p.category === from)
        ? { ...next, splits: next.splits.map((p) => (p.category === from ? { ...p, category: to } : p)) }
        : next;
    }),
  };
}

/** Adds a category to a group, taking it off the deleted and archived lists if it was on them. */
export function addCategory(data: BudgetData, name: string, type: string): BudgetData {
  if (!name || data.categories.includes(name)) return data;
  return setCategoryType(
    {
      ...data,
      categories: [...data.categories, name],
      deletedCategories: forgetDeleted(data.deletedCategories, name),
      archivedCategories: (data.archivedCategories ?? []).filter((c) => c !== name),
    },
    name,
    type,
  );
}

/** Removes a category: its transactions go back to untagged (a split using it is undone) and its rules are deleted. */
export function removeCategory(data: BudgetData, name: string): BudgetData {
  const rules = data.rules.filter((r) => r.category !== name);
  const transactions = data.transactions.map((t) =>
    t.splits?.some((p) => p.category === name)
      ? withSplit(t, null)
      : t.category === name
        ? { ...t, category: null, categorySource: null }
        : t,
  );
  return {
    ...data,
    categories: data.categories.filter((c) => c !== name),
    deletedCategories: [...new Set([...(data.deletedCategories ?? []), name])],
    archivedCategories: (data.archivedCategories ?? []).filter((c) => c !== name),
    categoryTypes: Object.fromEntries(Object.entries(data.categoryTypes ?? {}).filter(([c]) => c !== name)),
    rules,
    transactions: applyRules(transactions, rules),
  };
}

/** Archives a category, or brings it back. */
export function setArchived(data: BudgetData, name: string, archived: boolean): BudgetData {
  const others = (data.archivedCategories ?? []).filter((c) => c !== name);
  return { ...data, archivedCategories: archived ? [...others, name] : others };
}

/** How many transactions (counting split parts) and rules use a category. */
export function categoryUse(data: BudgetData, name: string): { transactions: number; rules: number } {
  const transactions = data.transactions.filter((t) => t.category === name || t.splits?.some((p) => p.category === name)).length;
  return { transactions, rules: data.rules.filter((r) => r.category === name).length };
}

/** Gives a category a type. */
export function setCategoryType(data: BudgetData, category: string, type: string): BudgetData {
  return { ...data, categoryTypes: { ...data.categoryTypes, [category]: type } };
}

/** The Income-kind groups as saved, with `type` added or taken off. */
function withIncome(data: BudgetData, type: string, income: boolean): string[] {
  const others = (data.incomeGroups ?? DEFAULT_INCOME_GROUPS).filter((t) => t !== type);
  return income ? [...others, type] : others;
}

/** Adds a group at the end of the list, of Income or Spending kind. */
export function addType(data: BudgetData, name: string, income = false): BudgetData {
  const types = typeList(data);
  if (types.includes(name)) return data;
  return { ...data, types: [...types, name], incomeGroups: withIncome(data, name, income), deletedTypes: (data.deletedTypes ?? []).filter((t) => t !== name) };
}

/** Makes a group Income kind (money in) or Spending kind. */
export function setTypeIncome(data: BudgetData, type: string, income: boolean): BudgetData {
  return { ...data, incomeGroups: withIncome(data, type, income) };
}

/** Removes a type; its categories count as the last remaining type until given another. */
export function removeType(data: BudgetData, name: string): BudgetData {
  const types = typeList(data).filter((t) => t !== name);
  if (types.length === 0) return data;
  const categoryTypes = Object.fromEntries(Object.entries(data.categoryTypes ?? {}).filter(([, t]) => t !== name));
  const noForecastTypes = (data.noForecastTypes ?? []).filter((t) => t !== name);
  return { ...data, types, categoryTypes, noForecastTypes, incomeGroups: withIncome(data, name, false), deletedTypes: [...new Set([...(data.deletedTypes ?? []), name])] };
}

/** Includes a type in the forecast or leaves it out. */
export function setTypeForecast(data: BudgetData, type: string, forecast: boolean): BudgetData {
  const others = (data.noForecastTypes ?? []).filter((t) => t !== type);
  return { ...data, noForecastTypes: forecast ? others : [...others, type] };
}

/** Moves a type one place up (-1) or down (+1) in the order. */
export function moveType(data: BudgetData, name: string, by: -1 | 1): BudgetData {
  const types = [...typeList(data)];
  const i = types.indexOf(name);
  const j = i + by;
  if (i < 0 || j < 0 || j >= types.length) return data;
  [types[i], types[j]] = [types[j], types[i]];
  return { ...data, types };
}

/** Renames a type, keeping its place and its categories. */
export function renameType(data: BudgetData, from: string, to: string): BudgetData {
  const types = typeList(data);
  if (!types.includes(from) || types.includes(to)) return data;
  return {
    ...data,
    types: types.map((t) => (t === from ? to : t)),
    categoryTypes: Object.fromEntries(Object.entries(data.categoryTypes ?? {}).map(([c, t]) => [c, t === from ? to : t])),
    noForecastTypes: (data.noForecastTypes ?? []).map((t) => (t === from ? to : t)),
    incomeGroups: (data.incomeGroups ?? DEFAULT_INCOME_GROUPS).map((t) => (t === from ? to : t)),
    deletedTypes: [...new Set([...(data.deletedTypes ?? []).filter((t) => t !== to), from])],
  };
}

/** Upgrades data saved by an older version of the app. */
export function migrate(data: BudgetData): BudgetData {
  let next = data;
  if ((next.version ?? 1) < 2) {
    for (const [from, to] of Object.entries(RENAMED_IN_V2)) next = renameCategory(next, from, to);
  }
  if ((next.version ?? 1) < 3) {
    // Before category types, essential categories were marked by ending their name with "*".
    const essential = new Set(next.essential ?? []);
    for (const c of next.categories) {
      const name = c.replace(/\s*\*+\s*$/, '');
      if (name === c || !name) continue;
      if (!next.categories.includes(name)) next = renameCategory(next, c, name);
      essential.add(name);
    }
    next = { ...next, essential: [...essential] };
  }
  if ((next.version ?? 1) < 4) {
    // Types became the user's own list: Essential, Living (added on the test copy) and Discretionary to start with.
    const { essential = [], living = [], ...rest } = next;
    const type = (c: string) => (essential.includes(c) ? 'Essential' : living.includes(c) ? 'Living' : 'Discretionary');
    next = {
      ...rest,
      types: next.types ?? [...DEFAULT_TYPES],
      categoryTypes: { ...Object.fromEntries(next.categories.filter((c) => !NOT_SPENDING.includes(c)).map((c) => [c, type(c)])), ...next.categoryTypes },
    };
  }
  if ((next.version ?? 1) < 5) {
    // Income and Transfers were built in until version 5, so make sure they're there to move into a group.
    const missing = NOT_SPENDING.filter((c) => !next.categories.includes(c));
    if (missing.length || next.deletedCategories?.some((c) => NOT_SPENDING.includes(c))) {
      const deletedCategories = (next.deletedCategories ?? []).filter((c) => !NOT_SPENDING.includes(c));
      next = { ...next, categories: [...next.categories, ...missing], deletedCategories };
      if (!deletedCategories.length) delete next.deletedCategories;
    }
    // Groups became Income or Spending kind: Income and Transfers go in an Income group at the top.
    if (!typeList(next).some((t) => (next.incomeGroups ?? []).includes(t))) {
      const types = typeList(next);
      next = {
        ...next,
        types: types.includes('Income') ? types : ['Income', ...types],
        incomeGroups: [...new Set([...(next.incomeGroups ?? []), 'Income'])],
        deletedTypes: next.deletedTypes?.filter((t) => t !== 'Income'),
      };
      if (!next.deletedTypes?.length) delete next.deletedTypes;
    }
    // With no group of their own they count as Income (see categoryType).
    const categoryTypes = { ...next.categoryTypes };
    for (const c of NOT_SPENDING) if (categoryTypes[c] && !isIncomeType(next, categoryTypes[c])) delete categoryTypes[c];
    next = { ...next, categoryTypes };
  }
  // The Claude features (and the Anthropic API key they used) were removed, so don't keep the key.
  if ('anthropicKey' in next) {
    const { anthropicKey: _, ...rest } = next as BudgetData & { anthropicKey?: string };
    next = rest;
  }
  return { ...next, version: VERSION };
}

export function loadData(): BudgetData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyData();
    // Saved data always has its own categories and groups; the old defaults are only for data from before there were any.
    return migrate({ transactions: [], rules: [], categories: [...DEFAULT_CATEGORIES], version: 1, ...JSON.parse(raw) });
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
