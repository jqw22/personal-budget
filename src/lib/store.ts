import { STORAGE_PREFIX } from './env';
import { applyRules } from './rules';
import { NOT_SPENDING } from './summary';
import { DEFAULT_CATEGORIES, DEFAULT_TYPES, typeList, type BudgetData, type Transaction } from './types';

const VERSION = 4;

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
  return { transactions: [], rules: [], categories: [...DEFAULT_CATEGORIES], types: [...DEFAULT_TYPES], categoryTypes: {}, version: VERSION };
}

/** The deleted-categories list without `name`, for when a category of that name is wanted again. */
export function forgetDeleted(deleted: string[] | undefined, name: string): string[] {
  return [...new Set((deleted ?? []).filter((c) => c !== name))];
}

/** Categories in A to Z order, for showing in lists and dropdowns. */
export function sortedCategories(categories: string[]): string[] {
  return [...categories].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

/** Renames a category everywhere it's used: the category list, its type, rules, forecast figures and tagged transactions. */
export function renameCategory(data: BudgetData, from: string, to: string): BudgetData {
  const rename = (c: string) => (c === from ? to : c);
  const forecast = data.forecast
    ? Object.fromEntries(
        Object.entries(data.forecast).map(([month, rows]) => [
          month,
          Object.fromEntries(Object.entries(rows).map(([row, pence]) => [rename(row), pence])),
        ]),
      )
    : undefined;
  return {
    ...data,
    categories: [...new Set(data.categories.map(rename))],
    deletedCategories: forgetDeleted([...(data.deletedCategories ?? []), from], to),
    ...(data.essential ? { essential: [...new Set(data.essential.map(rename))] } : {}),
    ...(data.categoryTypes
      ? { categoryTypes: Object.fromEntries(Object.entries(data.categoryTypes).map(([c, type]) => [rename(c), type])) }
      : {}),
    ...(forecast ? { forecast } : {}),
    rules: data.rules.map((r) => ({ ...r, category: rename(r.category) })),
    transactions: data.transactions.map((t) => {
      const next = t.category === from ? { ...t, category: to } : t;
      return next.splits?.some((p) => p.category === from)
        ? { ...next, splits: next.splits.map((p) => (p.category === from ? { ...p, category: to } : p)) }
        : next;
    }),
  };
}

/** Gives a category a type. */
export function setCategoryType(data: BudgetData, category: string, type: string): BudgetData {
  return { ...data, categoryTypes: { ...data.categoryTypes, [category]: type } };
}

/** Adds a type at the end of the list. */
export function addType(data: BudgetData, name: string): BudgetData {
  const types = typeList(data);
  if (types.includes(name)) return data;
  return { ...data, types: [...types, name], deletedTypes: (data.deletedTypes ?? []).filter((t) => t !== name) };
}

/** Removes a type; its categories count as the last remaining type until given another. */
export function removeType(data: BudgetData, name: string): BudgetData {
  const types = typeList(data).filter((t) => t !== name);
  if (types.length === 0) return data;
  const categoryTypes = Object.fromEntries(Object.entries(data.categoryTypes ?? {}).filter(([, t]) => t !== name));
  const noForecastTypes = (data.noForecastTypes ?? []).filter((t) => t !== name);
  return { ...data, types, categoryTypes, noForecastTypes, deletedTypes: [...new Set([...(data.deletedTypes ?? []), name])] };
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
