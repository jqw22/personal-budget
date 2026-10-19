import { useState } from 'react';
import { getInsights, InsightError } from '../lib/insights';
import type { BudgetData, Insight } from '../lib/types';
import { Markdown } from './Markdown';

interface Props {
  data: BudgetData;
  onChange: (data: BudgetData) => void;
  /** Saves a finished review onto whatever the data is by then, since writing one takes a while. */
  onInsight: (insight: Insight) => void;
  onOpenAccount: () => void;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function InsightsView({ data, onChange, onInsight, onOpenAccount }: Props) {
  const [goal, setGoal] = useState('');
  const [writing, setWriting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const goals = data.goals ?? [];

  function addGoal() {
    const text = goal.trim();
    if (!text) return;
    onChange({ ...data, goals: [...goals, { id: crypto.randomUUID(), text }] });
    setGoal('');
  }

  async function review() {
    setError(null);
    setWriting('');
    try {
      const text = await getInsights(data, today(), setWriting);
      onInsight({ at: new Date().toISOString(), text });
    } catch (e) {
      setError(e instanceof InsightError ? e.message : `Something went wrong: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setWriting(null);
    }
  }

  const shown = writing ?? data.insight?.text;

  return (
    <section>
      <h2>Goals</h2>
      {goals.length > 0 && (
        <table className="goals">
          <tbody>
            {goals.map((g) => (
              <tr key={g.id}>
                <td>{g.text}</td>
                <td className="num">
                  <button
                    className="link"
                    aria-label={`Remove goal: ${g.text}`}
                    onClick={() => onChange({ ...data, goals: goals.filter((x) => x.id !== g.id) })}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form
        className="inline add-goal"
        onSubmit={(e) => {
          e.preventDefault();
          addGoal();
        }}
      >
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="e.g. Save £3,000 for a holiday by June 2027"
          aria-label="New goal"
        />
        <button type="submit" disabled={!goal.trim()}>
          Add goal
        </button>
      </form>

      <h2>Insights</h2>
      {!data.anthropicKey ? (
        <p className="muted">
          Add your Anthropic API key in{' '}
          <button className="link inline-link" onClick={onOpenAccount}>
            Account
          </button>{' '}
          to get insights from Claude.
        </p>
      ) : (
        <button
          className="primary"
          title="Sends Claude your monthly totals, balances, forecast and goals, but no transaction descriptions or payees"
          disabled={writing !== null || data.transactions.length === 0}
          onClick={review}
        >
          {writing !== null ? 'Writing…' : data.insight ? 'Get new insights' : 'Get insights'}
        </button>
      )}
      {error && <p className="warning">{error}</p>}
      {shown !== undefined && (
        <div className="insight">
          {writing === null && data.insight && (
            <p className="muted small">
              Written{' '}
              {new Date(data.insight.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
          {shown ? <Markdown text={shown} /> : <p className="muted">Claude is looking at your figures…</p>}
        </div>
      )}
    </section>
  );
}
