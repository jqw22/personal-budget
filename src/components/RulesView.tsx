import { useState } from 'react';
import { applyRules } from '../lib/rules';
import { emptyData } from '../lib/store';
import type { BudgetData, Rule } from '../lib/types';

interface Props {
  data: BudgetData;
  onChange: (data: BudgetData) => void;
}

export function RulesView({ data, onChange }: Props) {
  const [newCategory, setNewCategory] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);

  function setRules(rules: Rule[]) {
    onChange({ ...data, rules, transactions: applyRules(data.transactions, rules) });
  }

  function addCategory() {
    const name = newCategory.trim();
    if (!name || data.categories.includes(name)) return;
    onChange({ ...data, categories: [...data.categories, name] });
    setNewCategory('');
  }

  function removeCategory(name: string) {
    const rules = data.rules.filter((r) => r.category !== name);
    const transactions = data.transactions.map((t) =>
      t.category === name ? { ...t, category: null, categorySource: null } : t,
    );
    onChange({
      ...data,
      categories: data.categories.filter((c) => c !== name),
      rules,
      transactions: applyRules(transactions, rules),
    });
  }

  const counts = new Map<string, number>();
  for (const t of data.transactions) if (t.category) counts.set(t.category, (counts.get(t.category) ?? 0) + 1);

  return (
    <section>
      <h2>Categories</h2>
      <ul className="chips">
        {data.categories.map((c) => (
          <li key={c}>
            {c}
            <span className="muted"> {counts.get(c) ?? 0}</span>
            <button className="link" title={`Remove ${c}`} onClick={() => removeCategory(c)}>
              ×
            </button>
          </li>
        ))}
      </ul>
      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault();
          addCategory();
        }}
      >
        <input placeholder="New category" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
        <button type="submit">Add</button>
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
                      {data.categories.map((c) => (
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
