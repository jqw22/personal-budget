import { useState } from 'react';
import { suggestTags, type TagSuggestion } from '../lib/autotag';
import { ClaudeError } from '../lib/claude';
import { formatMoney } from '../lib/format';
import { applyRules, upsertRule } from '../lib/rules';
import { sortedCategories } from '../lib/store';
import type { BudgetData } from '../lib/types';

interface Props {
  data: BudgetData;
  onChange: (data: BudgetData) => void;
}

/**
 * Claude suggests a category for each untagged merchant. Nothing changes until
 * the user applies them, and each one applied becomes a merchant rule.
 */
export function AutoTag({ data, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<TagSuggestion[] | null>(null);
  const categories = sortedCategories(data.categories);

  async function suggest() {
    setError(null);
    setBusy(true);
    try {
      setSuggestions(await suggestTags(data));
    } catch (e) {
      setError(e instanceof ClaudeError ? e.message : `Something went wrong: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function apply() {
    let rules = data.rules;
    for (const s of suggestions ?? []) if (s.category) rules = upsertRule(rules, s.merchant, s.category);
    onChange({ ...data, rules, transactions: applyRules(data.transactions, rules) });
    setSuggestions(null);
  }

  if (!suggestions) {
    return (
      <>
        <button
          disabled={busy || !data.anthropicKey}
          title={
            data.anthropicKey
              ? 'Sends Claude each untagged merchant name with how often and how much, plus your categories and rules'
              : 'Add your Anthropic API key in Account to use this'
          }
          onClick={suggest}
        >
          {busy ? 'Asking Claude…' : 'Suggest tags with Claude'}
        </button>
        {error && <p className="warning">{error}</p>}
      </>
    );
  }

  const picked = suggestions.filter((s) => s.category).length;
  return (
    <div className="auto-tag">
      <h3>Suggested tags</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Merchant</th>
              <th className="num">Count</th>
              <th className="num">Typical</th>
              <th>Category</th>
            </tr>
          </thead>
          <tbody>
            {suggestions.map((s, i) => (
              <tr key={s.merchant} className={s.category ? '' : 'untagged'}>
                <td>{s.merchant}</td>
                <td className="num">{s.count}</td>
                <td className={`num ${s.typical > 0 ? 'in' : ''}`}>{formatMoney(s.typical)}</td>
                <td>
                  <select
                    aria-label={`Category for ${s.merchant}`}
                    value={s.category ?? ''}
                    onChange={(e) =>
                      setSuggestions(suggestions.map((x, j) => (j === i ? { ...x, category: e.target.value || null } : x)))
                    }
                  >
                    <option value="">Leave untagged</option>
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="actions">
        <button className="primary" disabled={picked === 0} onClick={apply}>
          Apply {picked} tag{picked === 1 ? '' : 's'}
        </button>
        <button onClick={() => setSuggestions(null)}>Cancel</button>
      </div>
    </div>
  );
}
