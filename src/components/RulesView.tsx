import { useEffect, useState } from 'react';
import { expandSplits } from '../lib/splits';
import { applyRules } from '../lib/rules';
import { addCategory, addType, moveType, removeCategory as removeFromData, removeType, renameCategory, renameType, setArchived, setCategoryType, setTypeIncome, sortedCategories } from '../lib/store';
import { categoryType, incomeTypes, isIncomeType, spendingTypes, typeList } from '../lib/types';
import type { BudgetData, Rule } from '../lib/types';

/** Every group as a dropdown option, Income groups then Spending groups. */
function GroupOptions({ data }: { data: BudgetData }) {
  return (
    <>
      {[
        { label: 'Income', list: incomeTypes(data) },
        { label: 'Spending', list: spendingTypes(data) },
      ]
        .filter((g) => g.list.length > 0)
        .map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.list.map((type) => (
              <option key={type} value={type}>
                {type}
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
  /** The Categories tab (groups and categories) or the Rules tab (merchant rules). */
  part: 'categories' | 'rules';
  /** A rule to bring into view and highlight, e.g. after clicking "auto" on a transaction. */
  focusRule?: string | null;
}

export function RulesView({ data, onChange, part, focusRule }: Props) {
  const [newCategory, setNewCategory] = useState('');
  const [newType, setNewType] = useState('');
  const [newTypeName, setNewTypeName] = useState('');
  const [newTypeIncome, setNewTypeIncome] = useState(false);
  const [editingType, setEditingType] = useState<{ from: string; to: string } | null>(null);
  const [editing, setEditing] = useState<{ from: string; to: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  /** Merchant rules A to Z by merchant, or grouped by category. */
  const [ruleSort, setRuleSort] = useState<'merchant' | 'category'>('merchant');
  /** The rule whose Delete was clicked, waiting for a yes. */
  const [confirmRuleDelete, setConfirmRuleDelete] = useState<string | null>(null);
  useEffect(() => {
    if (focusRule) document.getElementById(`rule-${focusRule}`)?.scrollIntoView({ block: 'center' });
  }, [focusRule]);

  function setRules(rules: Rule[]) {
    onChange({ ...data, rules, transactions: applyRules(data.transactions, rules) });
  }

  function addNewCategory() {
    const name = newCategory.trim();
    if (!name || !newType || data.categories.includes(name)) return;
    onChange(addCategory(data, name, newType));
    setNewCategory('');
    setNewType('');
  }

  const setType = setCategoryType;

  function finishTypeRename() {
    if (!editingType) return;
    const to = editingType.to.trim();
    if (to && to !== editingType.from) onChange(renameType(data, editingType.from, to));
    setEditingType(null);
  }

  function addNewType() {
    const name = newTypeName.trim();
    if (!name || types.includes(name)) return;
    onChange(addType(data, name, newTypeIncome));
    setNewTypeIncome(false);
    setNewTypeName('');
  }

  function finishRename() {
    if (!editing) return;
    const to = editing.to.trim();
    if (to && to !== editing.from && !data.categories.includes(to)) onChange(renameCategory(data, editing.from, to));
    setEditing(null);
  }

  function removeCategory(name: string) {
    onChange(removeFromData(data, name));
  }

  const types = typeList(data);
  const archived = new Set(data.archivedCategories ?? []);
  // Income groups' categories at the top, then each Spending group's, in the groups' order, each A to Z.
  const sorted = sortedCategories(data.categories);
  const categories = [...incomeTypes(data), ...spendingTypes(data)].flatMap((type) => sorted.filter((c) => categoryType(data, c) === type));
  const counts = new Map<string, number>();
  for (const t of expandSplits(data.transactions)) if (t.category) counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
  const rulesFor = (c: string) => data.rules.filter((r) => r.category === c).length;
  const inUse = (c: string) => (counts.get(c) ?? 0) > 0 || rulesFor(c) > 0;
  const categoriesOfType = (type: string) => data.categories.filter((c) => categoryType(data, c) === type).length;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  return (
    <section>
      {part === 'categories' && (
        <>
        <h2>Groups</h2>
        <p className="muted">
          Income groups are money in; Spending groups are money out. The summary shows Income groups first, then Spending
          groups, each in this order. Click a group's name to rename it.
        </p>
        <table className="categories types">
          <thead>
            <tr>
              <th>Group</th>
              <th>Kind</th>
              <th className="num">Categories</th>
              <th>Order</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {types.map((type, i) => (
              <tr key={type}>
                <td>
                  {editingType?.from === type ? (
                    <input
                      autoFocus
                      aria-label={`Rename ${type}`}
                      value={editingType.to}
                      onChange={(e) => setEditingType({ from: type, to: e.target.value })}
                      onBlur={finishTypeRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') finishTypeRename();
                        if (e.key === 'Escape') setEditingType(null);
                      }}
                    />
                  ) : (
                    <button className="link name" title={`Rename ${type}`} onClick={() => setEditingType({ from: type, to: type })}>
                      {type}
                    </button>
                  )}
                </td>
                <td>
                  <select
                    aria-label={`Kind of ${type}`}
                    value={isIncomeType(data, type) ? 'income' : 'spending'}
                    onChange={(e) => onChange(setTypeIncome(data, type, e.target.value === 'income'))}
                  >
                    <option value="income">Income</option>
                    <option value="spending">Spending</option>
                  </select>
                </td>
                <td className="num muted">{categoriesOfType(type)}</td>
                <td className="order">
                  <button className="link" title={`Move ${type} up`} disabled={i === 0} onClick={() => onChange(moveType(data, type, -1))}>
                    ↑
                  </button>
                  <button
                    className="link"
                    title={`Move ${type} down`}
                    disabled={i === types.length - 1}
                    onClick={() => onChange(moveType(data, type, 1))}
                  >
                    ↓
                  </button>
                </td>
                <td>
                  <button
                    className="link"
                    title={categoriesOfType(type) ? `Move ${type}'s categories to another group before removing it` : `Remove ${type}`}
                    disabled={categoriesOfType(type) > 0 || types.length === 1}
                    onClick={() => onChange(removeType(data, type))}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form
          className="inline"
          onSubmit={(e) => {
            e.preventDefault();
            addNewType();
          }}
        >
          <input placeholder="New group" value={newTypeName} onChange={(e) => setNewTypeName(e.target.value)} />
          <select aria-label="New group kind" value={newTypeIncome ? 'income' : 'spending'} onChange={(e) => setNewTypeIncome(e.target.value === 'income')}>
            <option value="spending">Spending</option>
            <option value="income">Income</option>
          </select>
          <button type="submit" disabled={!newTypeName.trim() || types.includes(newTypeName.trim())}>
            Add
          </button>
        </form>

        <h2>Categories</h2>
        <p className="muted">Click a category's name to rename it. Tagged transactions and rules follow the new name.</p>
        <table className="categories">
          <thead>
            <tr>
              <th>Category</th>
              <th>Group</th>
              <th className="num">Transactions</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c}>
                <td>
                  {editing?.from === c ? (
                    <input
                      autoFocus
                      aria-label={`Rename ${c}`}
                      value={editing.to}
                      onChange={(e) => setEditing({ from: c, to: e.target.value })}
                      onBlur={finishRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') finishRename();
                        if (e.key === 'Escape') setEditing(null);
                      }}
                    />
                  ) : (
                    <button className="link name" title={`Rename ${c}`} onClick={() => setEditing({ from: c, to: c })}>
                      {c}
                    </button>
                  )}
                  {archived.has(c) && editing?.from !== c && (
                    <span className="muted"> (archived)</span>
                  )}
                </td>
                <td>
                  <select
                    aria-label={`Group of ${c}`}
                    value={categoryType(data, c)}
                    onChange={(e) => onChange(setType(data, c, e.target.value))}
                  >
                    <GroupOptions data={data} />
                  </select>
                </td>
                <td className="num muted">{counts.get(c) ?? 0}</td>
                <td>
                  <button
                    className="link"
                    title={archived.has(c) ? `Bring ${c} back into tagging lists and the summary` : `Archive ${c}: keep it and its transactions, but hide it from tagging lists, and from the summary when it has nothing`}
                    onClick={() => onChange(setArchived(data, c, !archived.has(c)))}
                  >
                    {archived.has(c) ? 'Unarchive' : 'Archive'}
                  </button>{' '}
                  <button
                    className="link"
                    title={`Remove ${c}`}
                    onClick={() => (inUse(c) ? setConfirmRemove(c) : removeCategory(c))}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {confirmRemove && (
          <div className="warning">
            <p>
              <strong>{confirmRemove}</strong> is used by {plural(counts.get(confirmRemove) ?? 0, 'transaction')}
              {rulesFor(confirmRemove) > 0 && ` and ${plural(rulesFor(confirmRemove), 'merchant rule')}`}. Removing it
              leaves those transactions untagged
              {rulesFor(confirmRemove) > 0 && ` and deletes the rule${rulesFor(confirmRemove) === 1 ? '' : 's'}`}.
            </p>
            <div className="actions">
              <button
                className="danger"
                onClick={() => {
                  removeCategory(confirmRemove);
                  setConfirmRemove(null);
                }}
              >
                Remove {confirmRemove}
              </button>
              <button onClick={() => setConfirmRemove(null)}>Cancel</button>
            </div>
          </div>
        )}
        <form
          className="inline"
          onSubmit={(e) => {
            e.preventDefault();
            addNewCategory();
          }}
        >
          <input placeholder="New category" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
          <select aria-label="New category group" required value={newType} onChange={(e) => setNewType(e.target.value)}>
            <option value="" disabled>
              Group…
            </option>
            <GroupOptions data={data} />
          </select>
          <button type="submit" disabled={!newCategory.trim() || !newType}>
            Add
          </button>
        </form>
        </>
      )}
      {part === 'rules' && (
        <>
        <h2>Merchant rules</h2>
        <p className="muted">
          A rule tags every transaction whose merchant contains the text. Shorten the text to cover more, for example
          "HOME BARGAINS" matches every branch. Transactions you tagged by hand are never changed by a rule.
        </p>
        {data.rules.length === 0 ? (
          <p className="muted">No rules yet. They're created as you tag transactions.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th aria-sort={ruleSort === 'merchant' ? 'ascending' : undefined}>
                  <button className="link sort" title="Sort by merchant, A to Z" onClick={() => setRuleSort('merchant')}>
                    Merchant contains{ruleSort === 'merchant' && ' ▲'}
                  </button>
                </th>
                <th aria-sort={ruleSort === 'category' ? 'ascending' : undefined}>
                  <button className="link sort" title="Sort by category, A to Z, then merchant" onClick={() => setRuleSort('category')}>
                    Category{ruleSort === 'category' && ' ▲'}
                  </button>
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...data.rules]
                .sort((a, b) => {
                  const byMerchant = a.match.localeCompare(b.match, 'en', { sensitivity: 'base' });
                  return ruleSort === 'category' ? a.category.localeCompare(b.category, 'en', { sensitivity: 'base' }) || byMerchant : byMerchant;
                })
                .map((r) => (
                  <tr key={r.id} id={`rule-${r.id}`} className={r.id === focusRule ? 'highlight' : ''}>
                    <td>
                      <input
                        autoFocus={r.id === focusRule}
                        value={r.match}
                        onChange={(e) =>
                          setRules(data.rules.map((x) => (x.id === r.id ? { ...x, match: e.target.value } : x)))
                        }
                      />
                    </td>
                    <td>
                      <select
                        value={r.category}
                        onChange={(e) =>
                          setRules(data.rules.map((x) => (x.id === r.id ? { ...x, category: e.target.value } : x)))
                        }
                      >
                        {categories.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="nowrap">
                      {confirmRuleDelete === r.id ? (
                        <>
                          Delete this rule?{' '}
                          <button
                            className="link danger-link"
                            onClick={() => {
                              setRules(data.rules.filter((x) => x.id !== r.id));
                              setConfirmRuleDelete(null);
                            }}
                          >
                            Yes
                          </button>{' '}
                          <button className="link" onClick={() => setConfirmRuleDelete(null)}>
                            No
                          </button>
                        </>
                      ) : (
                        <button className="link" onClick={() => setConfirmRuleDelete(r.id)}>
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
        </>
      )}
    </section>
  );
}
