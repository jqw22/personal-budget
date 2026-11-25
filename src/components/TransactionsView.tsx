import { Fragment, useMemo, useState } from 'react';
import { ImportView } from './ImportView';
import { formatDate, formatMoney, formatMonth } from '../lib/format';
import { applyRules, findRule, upsertRule } from '../lib/rules';
import { download, impliedOpeningBalance, runningBalances, toCsv } from '../lib/export';
import { parseMoney } from '../lib/importer';
import { amountIn, isTagged, splitProblem, withSplit } from '../lib/splits';
import { sortedCategories } from '../lib/store';
import { categoryType, incomeTypes, spendingTypes, type BudgetData, type Split, type Transaction } from '../lib/types';

/** Categories under their group: Income groups first, then Spending groups, in order, each A to Z. */
type CategoryGroups = { label: string; categories: string[] }[];

function categoryGroups(data: BudgetData): CategoryGroups {
  const sorted = sortedCategories(data.categories);
  return [...incomeTypes(data), ...spendingTypes(data)]
    .map((type) => ({ label: type, categories: sorted.filter((c) => categoryType(data, c) === type) }))
    .filter((g) => g.categories.length > 0);
}

/** A dropdown's category options, headed by their group so it shows while choosing. */
function CategoryOptions({ groups, current }: { groups: CategoryGroups; current?: string | null }) {
  // An archived category isn't offered, but one already chosen still shows.
  const missing = current && !groups.some((g) => g.categories.includes(current)) ? current : null;
  return (
    <>
      {missing && <option value={missing}>{missing} (archived)</option>}
      {groups.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

interface Props {
  data: BudgetData;
  onChange: (data: BudgetData) => void;
  /** Filters to open with, e.g. when coming from the summary. */
  initialFilter?: TransactionFilter;
  /** Opens the Rules tab at this rule, from a transaction's Auto link. */
  onOpenRule?: (ruleId: string) => void;
}

/** Category filter value that shows only untagged transactions. */
export const UNTAGGED_FILTER = '__untagged__';

export interface TransactionFilter {
  month: string;
  /** A category name, 'all', or UNTAGGED_FILTER. */
  category: string;
}

/** Newest first, biggest money out first, or biggest money in first. */
type Sort = 'date' | 'amount-out' | 'amount-in' | 'merchant';

const NEXT_AMOUNT_SORT: Record<Sort, Sort> = { date: 'amount-out', 'amount-out': 'amount-in', 'amount-in': 'date', merchant: 'amount-out' };

export function TransactionsView({ data, onChange, initialFilter, onOpenRule }: Props) {
  const months = useMemo(
    () => [...new Set(data.transactions.map((t) => t.date.slice(0, 7)))].sort().reverse(),
    [data.transactions],
  );
  const [month, setMonth] = useState<string>(initialFilter?.month ?? 'all');
  const [category, setCategory] = useState<string>(initialFilter?.category ?? 'all');
  const [remember, setRemember] = useState(false);
  const [search, setSearch] = useState('');
  /** Tagged by a merchant rule (auto), by hand (including splits), or either. */
  const [source, setSource] = useState<'all' | 'auto' | 'manual'>('all')
  /** Split transactions only, unsplit only, or either. */
  const [splitFilter, setSplitFilter] = useState<'all' | 'split' | 'unsplit'>('all');
  const [sort, setSort] = useState<Sort>('date');
  /** The transaction whose split is being edited. */
  const [splitting, setSplitting] = useState<string | null>(null);
  /** The transaction whose note is being written, and the text so far. */
  const [noting, setNoting] = useState<{ id: string; text: string } | null>(null);
  /** Whether the bank statement import is open above the list. */
  const [importing, setImporting] = useState(false);

  const shown = data.transactions
    .filter((t) => month === 'all' || t.date.startsWith(month))
    .filter(
      (t) =>
        category === 'all' ||
        (category === UNTAGGED_FILTER ? !isTagged(t) : t.category === category || t.splits?.some((p) => p.category === category)),
    )
    .filter((t) =>
      source === 'all'
        ? true
        : source === 'auto'
          ? t.categorySource === 'rule' && !t.splits?.length
          : t.categorySource === 'manual',
    )
    .filter((t) => splitFilter === 'all' || (splitFilter === 'split') === !!t.splits?.length)
    .filter((t) => !search || `${t.description}\n${t.note ?? ''}`.toLowerCase().includes(search.toLowerCase()))
    .slice()
    .reverse();
  // Merchant is A to Z, keeping each merchant's newest first.
  if (sort === 'merchant') shown.sort((a, b) => a.merchant.localeCompare(b.merchant, 'en', { sensitivity: 'base' }));
  else if (sort !== 'date') shown.sort((a, b) => (sort === 'amount-out' ? a.amount - b.amount : b.amount - a.amount));

  function tag(t: Transaction, category: string) {
    if (!category) {
      // Clearing a tag hands the transaction back to the rules.
      const transactions = data.transactions.map((x) =>
        x.id === t.id ? { ...x, category: null, categorySource: null } : x,
      );
      onChange({ ...data, transactions: applyRules(transactions, data.rules) });
      return;
    }
    const transactions = data.transactions.map((x) =>
      x.id === t.id ? { ...x, category, categorySource: 'manual' as const } : x,
    );
    if (!remember) {
      onChange({ ...data, transactions });
      return;
    }
    const rules = upsertRule(data.rules, t.merchant, category);
    onChange({ ...data, rules, transactions: applyRules(transactions, rules) });
  }

  function split(t: Transaction, parts: Split[] | null) {
    const transactions = data.transactions.map((x) => (x.id === t.id ? withSplit(x, parts) : x));
    // Without its split, the transaction goes back to the rules like any untagged one.
    onChange({ ...data, transactions: parts ? transactions : applyRules(transactions, data.rules) });
    setSplitting(null);
  }

  function saveNote() {
    if (!noting) return;
    const text = noting.text.trim();
    const transactions = data.transactions.map((x) => {
      if (x.id !== noting.id) return x;
      const { note: _, ...rest } = x;
      return text ? { ...rest, note: text } : rest;
    });
    onChange({ ...data, transactions });
    setNoting(null);
  }

  // With nothing imported yet, the import is all there is to show.
  if (data.transactions.length === 0) return <ImportView data={data} onChange={onChange} onDone={() => setImporting(false)} />;

  // Worked back from the bank's own balance column in the imported statements.
  const opening = impliedOpeningBalance(data.transactions);
  // Worked out over every transaction, so a filtered download still shows the real balance on each row.
  const balances = opening === null ? null : runningBalances(data.transactions, opening);
  const untagged = data.transactions.filter((t) => !isTagged(t)).length;
  const groups = categoryGroups(data);
  // Tagging lists leave archived categories out; the filter keeps them.
  const archived = new Set(data.archivedCategories ?? []);
  const tagGroups = groups.map((g) => ({ ...g, categories: g.categories.filter((c) => !archived.has(c)) })).filter((g) => g.categories.length > 0);

  return (
    <section>
      <div className="heading-row">
        <h2>Transactions</h2>
        <button onClick={() => setImporting(!importing)}>{importing ? 'Close import' : 'Import CSV'}</button>
      </div>
      {importing && (
        <div className="import-panel">
          <ImportView data={data} onChange={onChange} onDone={() => setImporting(false)} />
        </div>
      )}
      <p className="muted">
        {untagged === 0 ? 'Everything is tagged.' : `${untagged} of ${data.transactions.length} still need a category.`}
      </p>
      <div className="filters">
        <select value={month} onChange={(e) => setMonth(e.target.value)}>
          <option value="all">All months</option>
          {/* Each year, newest first, followed by its months. */}
          {[...new Set(months.map((m) => m.slice(0, 4)))].map((y) => (
            <Fragment key={y}>
              <option value={y}>All of {y}</option>
              {months
                .filter((m) => m.startsWith(y))
                .map((m) => (
                  <option key={m} value={m}>
                    {formatMonth(m)}
                  </option>
                ))}
            </Fragment>
          ))}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="all">All categories</option>
          <option value={UNTAGGED_FILTER}>Untagged</option>
          <CategoryOptions groups={groups} />
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value as typeof source)} aria-label="Tagged by">
          <option value="all">Auto and by hand</option>
          <option value="auto">Auto only</option>
          <option value="manual">By hand only</option>
        </select>
        <select value={splitFilter} onChange={(e) => setSplitFilter(e.target.value as typeof splitFilter)} aria-label="Split">
          <option value="all">Split and not split</option>
          <option value="split">Split only</option>
          <option value="unsplit">Not split</option>
        </select>
        <input type="search" placeholder="Search descriptions and notes" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label title="When you tag a transaction, tag every other transaction from the same place the same way">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember for this merchant
        </label>
        <button
          disabled={shown.length === 0}
          title="Download the transactions shown below as a CSV file, oldest first unless sorted by amount"
          onClick={() =>
            download(
              `transactions-${month === 'all' ? 'all' : month}-${new Date().toISOString().slice(0, 10)}.csv`,
              toCsv(sort === 'date' ? [...shown].reverse() : shown, balances ?? undefined),
            )
          }
        >
          Download CSV
        </button>
      </div>
      <div className="table-wrap">
        <table className="transactions">
          <thead>
            {shown.length > 0 && (
              <tr className="total-row">
                <th colSpan={2}>
                  Total of {shown.length} transaction{shown.length === 1 ? '' : 's'}
                </th>
                <th className="num">
                  {/* Filtered to one category, a split counts only its parts in that category. */}
                  {formatMoney(shown.reduce((total, t) => total + (category === 'all' || category === UNTAGGED_FILTER ? t.amount : amountIn(t, category)), 0))}
                </th>
                <th colSpan={4} />
              </tr>
            )}
            <tr className="col-heads">
              <th aria-sort={sort === 'date' ? 'descending' : undefined}>
                <button className="link sort" title="Sort by date, newest first" onClick={() => setSort('date')}>
                  Date{sort === 'date' && ' ▼'}
                </button>
              </th>
              <th aria-sort={sort === 'merchant' ? 'ascending' : undefined}>
                <button className="link sort" title="Sort by merchant, A to Z" onClick={() => setSort('merchant')}>
                  Merchant{sort === 'merchant' && ' ▲'}
                </button>
              </th>
              <th className="num" aria-sort={sort === 'amount-out' ? 'ascending' : sort === 'amount-in' ? 'descending' : undefined}>
                <button
                  className="link sort"
                  title={
                    sort === 'amount-out' ? 'Sort with biggest money in first' : sort === 'amount-in' ? 'Sort by date' : 'Sort with biggest spend first'
                  }
                  onClick={() => setSort(NEXT_AMOUNT_SORT[sort])}
                >
                  Amount{sort === 'amount-out' ? ' ▼' : sort === 'amount-in' ? ' ▲' : ''}
                </button>
              </th>
              <th>Category</th>
              <th>Auto</th>
              <th>Split</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => (
              <Fragment key={t.id}>
                <tr className={isTagged(t) ? '' : 'untagged'}>
                  <td className="nowrap">{formatDate(t.date)}</td>
                  <td title={t.description}>
                    {t.merchant}
                  </td>
                  <td className={`num ${t.amount > 0 ? 'in' : ''}`}>{formatMoney(t.amount)}</td>
                  <td>
                    {t.splits?.length ? (
                      <div className="split-parts">
                        {t.splits.map((p, i) => (
                          <div key={i}>
                            {p.category} <span className="muted">{formatMoney(p.amount)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <select value={t.category ?? ''} onChange={(e) => tag(t, e.target.value)}>
                        <option value="">Untagged</option>
                        <CategoryOptions groups={tagGroups} current={t.category} />
                      </select>
                    )}
                  </td>
                  <td className="nowrap">
                    {t.categorySource === 'rule' && (
                      <button
                        className="link auto-link"
                        title="Tagged by a merchant rule: open the rule to edit it"
                        onClick={() => {
                          const rule = findRule(data.rules, t.merchant);
                          if (rule) onOpenRule?.(rule.id);
                        }}
                      >
                        Auto
                      </button>
                    )}
                  </td>
                  <td className="nowrap">
                    <button
                      className="link split-button"
                      title={t.splits?.length ? 'Change or remove this split' : 'Split into parts with different categories'}
                      onClick={() => setSplitting(splitting === t.id ? null : t.id)}
                    >
                      {t.splits?.length ? 'Edit split' : 'Split'}
                    </button>
                  </td>
                  <td className="note-cell">
                    {noting?.id === t.id ? (
                      <input
                        className="note-input"
                        autoFocus
                        aria-label={`Note on ${t.merchant}`}
                        placeholder="Add a note"
                        value={noting.text}
                        onChange={(e) => setNoting({ id: t.id, text: e.target.value })}
                        onBlur={saveNote}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveNote();
                          if (e.key === 'Escape') setNoting(null);
                        }}
                      />
                    ) : t.note ? (
                      <button className="link note" title="Change this note" onClick={() => setNoting({ id: t.id, text: t.note ?? '' })}>
                        {t.note}
                      </button>
                    ) : (
                      <button className="link note-add" onClick={() => setNoting({ id: t.id, text: '' })}>
                        + Note
                      </button>
                    )}
                  </td>
                </tr>
                {splitting === t.id && (
                  <tr className="split-row">
                    <td colSpan={7}>
                      <SplitEditor t={t} groups={tagGroups} onSave={(parts) => split(t, parts)} onCancel={() => setSplitting(null)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length === 0 && <p className="muted">Nothing matches these filters.</p>}
    </section>
  );
}

/**
 * Splits one transaction into as many parts as needed, each with its own category. Every part's amount but
 * the last is typed in, and the last is whatever is left, so the parts always add up to the whole.
 */
function SplitEditor({
  t,
  groups,
  onSave,
  onCancel,
}: {
  t: Transaction;
  groups: CategoryGroups;
  onSave: (parts: Split[] | null) => void;
  onCancel: () => void;
}) {
  const sign = Math.sign(t.amount) || -1;
  const whole = Math.abs(t.amount);
  const [rows, setRows] = useState<{ amount: string; category: string }[]>(() =>
    t.splits?.length
      ? t.splits.map((p) => ({ amount: (Math.abs(p.amount) / 100).toFixed(2), category: p.category }))
      : [
          { amount: '', category: t.category ?? '' },
          { amount: '', category: '' },
        ],
  );
  const typed = rows.slice(0, -1).map((r) => {
    const pence = parseMoney(r.amount);
    return pence === null ? null : Math.abs(pence);
  });
  const allTyped = typed.every((p) => p !== null);
  const rest = allTyped ? whole - typed.reduce<number>((total, p) => total + (p ?? 0), 0) : null;
  const parts: Split[] | null = allTyped
    ? rows.map((r, i) => ({ amount: sign * (i < rows.length - 1 ? typed[i]! : rest!), category: r.category }))
    : null;
  const problem = parts
    ? splitProblem(t, parts)
    : rows.slice(0, -1).some((r) => r.amount.trim())
      ? 'Type an amount for each part but the last.'
      : null;
  const update = (i: number, change: Partial<{ amount: string; category: string }>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...change } : r)));

  return (
    <div className="split-editor">
      {rows.map((r, i) => (
        <div key={i}>
          {i < rows.length - 1 ? (
            <input
              className="forecast-input"
              inputMode="decimal"
              aria-label={`Part ${i + 1}`}
              placeholder="0.00"
              value={r.amount}
              autoFocus={i === 0}
              onChange={(e) => update(i, { amount: e.target.value })}
            />
          ) : (
            <span className="split-rest" title="Whatever is left">
              {rest === null || rest < 0 ? '–' : formatMoney(sign * rest)}
            </span>
          )}
          <select value={r.category} onChange={(e) => update(i, { category: e.target.value })} aria-label={`Part ${i + 1} category`}>
            <option value="">Choose…</option>
            <CategoryOptions groups={groups} current={r.category} />
          </select>
          {rows.length > 2 && (
            <button className="link" title={`Remove part ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              ×
            </button>
          )}
        </div>
      ))}
      <div className="split-actions">
        <button
          className="link split-add"
          // The new part goes before the last, which keeps taking whatever is left.
          onClick={() => setRows([...rows.slice(0, -1), { amount: '', category: '' }, rows[rows.length - 1]])}
        >
          + Add part
        </button>
        <span className="muted small">
          {problem ?? (parts ? `Adds up to ${formatMoney(t.amount)}.` : `Split ${formatMoney(t.amount)} into as many parts as you need.`)}
        </span>
        <button className="primary" disabled={!parts || problem !== null} onClick={() => parts && onSave(parts)}>
          Save split
        </button>
        {t.splits?.length ? <button onClick={() => onSave(null)}>Remove split</button> : null}
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
