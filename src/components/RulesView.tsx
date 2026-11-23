import { useState } from 'react';
import { expandSplits, withSplit } from '../lib/splits';
import { applyRules } from '../lib/rules';
import { addType, emptyData, moveType, removeType, renameCategory, renameType, setCategoryType, setTypeForecast, sortedCategories, forgetDeleted } from '../lib/store';
import { categoryType, typeList } from '../lib/types';
import { NOT_SPENDING } from '../lib/summary';
import type { BudgetData, Rule } from '../lib/types';


interface Props {
  data: BudgetData;
  onChange: (data: BudgetData) => void;
}

export function RulesView({ data, onChange }: Props) {
  const [newCategory, setNewCategory] = useState('');
  const [newType, setNewType] = useState('');
  const [newTypeName, setNewTypeName] = useState('');
  const [editingType, setEditingType] = useState<{ from: string; to: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [editing, setEditing] = useState<{ from: string; to: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  function setRules(rules: Rule[]) {
    onChange({ ...data, rules, transactions: applyRules(data.transactions, rules) });
  }

  function addCategory() {
    const name = newCategory.trim();
    if (!name || !newType || data.categories.includes(name)) return;
    onChange(setType({ ...data, categories: [...data.categories, name], deletedCategories: forgetDeleted(data.deletedCategories, name) }, name, newType));
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
    onChange(addType(data, name));
    setNewTypeName('');
  }

  function finishRename() {
    if (!editing) return;
    const to = editing.to.trim();
    if (to && to !== editing.from && !data.categories.includes(to)) onChange(renameCategory(data, editing.from, to));
    setEditing(null);
  }

  function removeCategory(name: string) {
    const rules = data.rules.filter((r) => r.category !== name);
    // A split with a part in this category goes back to one untagged transaction.
    const transactions = data.transactions.map((t) =>
      t.splits?.some((p) => p.category === name)
        ? withSplit(t, null)
        : t.category === name
          ? { ...t, category: null, categorySource: null }
          : t,
    );
    onChange({
      ...data,
      categories: data.categories.filter((c) => c !== name),
      deletedCategories: [...new Set([...(data.deletedCategories ?? []), name])],
      categoryTypes: Object.fromEntries(Object.entries(data.categoryTypes ?? {}).filter(([c]) => c !== name)),
      rules,
      transactions: applyRules(transactions, rules),
    });
  }

  const types = typeList(data);
  // Not spending (Income, Transfers) at the top, then each spending type in the types' order, each A to Z.
  const sorted = sortedCategories(data.categories);
  const categories = [
    ...sorted.filter((c) => NOT_SPENDING.includes(c)),
    ...types.flatMap((type) => sorted.filter((c) => !NOT_SPENDING.includes(c) && categoryType(data, c) === type)),
  ];
  const counts = new Map<string, number>();
  for (const t of expandSplits(data.transactions)) if (t.category) counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
  const rulesFor = (c: string) => data.rules.filter((r) => r.category === c).length;
  const inUse = (c: string) => (counts.get(c) ?? 0) > 0 || rulesFor(c) > 0;
  const spending = data.categories.filter((c) => !NOT_SPENDING.includes(c));
  const categoriesOfType = (type: string) => spending.filter((c) => categoryType(data, c) === type).length;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  return (
    <section>
      <h2>Categories</h2>
      <p className="muted">Click a category's name to rename it. Tagged transactions and rules follow the new name.</p>
      <table className="categories">
        <thead>
          <tr>
            <th>Category</th>
            <th>Type</th>
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
              </td>
              <td>
                {NOT_SPENDING.includes(c) ? (
                  <span className="muted">Not spending</span>
                ) : (
                  <select
                    aria-label={`Type of ${c}`}
                    value={categoryType(data, c)}
                    onChange={(e) => onChange(setType(data, c, e.target.value))}
                  >
                    {types.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                )}
              </td>
              <td className="num muted">{counts.get(c) ?? 0}</td>
              <td>
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
          addCategory();
        }}
      >
        <input placeholder="New category" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
        <select aria-label="New category type" required value={newType} onChange={(e) => setNewType(e.target.value)}>
          <option value="" disabled>
            Type…
          </option>
          {types.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <button type="submit" disabled={!newCategory.trim() || !newType}>
          Add
        </button>
      </form>

      <h2>Types</h2>
      <p className="muted">
        The summary groups spending by type, in this order. Click a type's name to rename it. A type that isn't forecast
        starts at £0 in the forecast instead of its average; you can still type in a figure.
      </p>
      <table className="categories types">
        <thead>
          <tr>
            <th>Type</th>
            <th className="num">Categories</th>
            <th>Forecast</th>
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
              <td className="num muted">{categoriesOfType(type)}</td>
              <td>
                <label className="forecast-toggle">
                  <input
                    type="checkbox"
                    aria-label={`Forecast ${type}`}
                    checked={!(data.noForecastTypes ?? []).includes(type)}
                    onChange={(e) => onChange(setTypeForecast(data, type, e.target.checked))}
                  />
                  {(data.noForecastTypes ?? []).includes(type) ? 'No' : 'Yes'}
                </label>
              </td>
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
                  title={categoriesOfType(type) ? `Give ${type}'s categories another type before removing it` : `Remove ${type}`}
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
        <input placeholder="New type" value={newTypeName} onChange={(e) => setNewTypeName(e.target.value)} />
        <button type="submit" disabled={!newTypeName.trim() || types.includes(newTypeName.trim())}>
          Add
        </button>
      </form>

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
              <th>Merchant contains</th>
              <th>Category</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {[...data.rules]
              .sort((a, b) => a.match.localeCompare(b.match))
              .map((r) => (
                <tr key={r.id}>
                  <td>
                    <input
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
                  <td>
                    <button className="link" onClick={() => setRules(data.rules.filter((x) => x.id !== r.id))}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      )}

      <h2>Your data</h2>
      <p className="muted">Everything is saved in this browser for now.</p>
      {confirmReset ? (
        <p>
          Delete all transactions, rules and categories?{' '}
          <button
            className="danger"
            onClick={() => {
              onChange(emptyData());
              setConfirmReset(false);
            }}
          >
            Yes, delete everything
          </button>{' '}
          <button onClick={() => setConfirmReset(false)}>Cancel</button>
        </p>
      ) : (
        <button onClick={() => setConfirmReset(true)}>Delete all data…</button>
      )}
    </section>
  );
}
