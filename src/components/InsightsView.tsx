import { useState } from 'react';
import { ClaudeError } from '../lib/claude';
import { askFollowUp, getInsights } from '../lib/insights';
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
  const [question, setQuestion] = useState('');
  /** A reply being answered, and the answer so far. */
  const [answering, setAnswering] = useState<{ question: string; answer: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
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
      setError(e instanceof ClaudeError ? e.message : `Something went wrong: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setWriting(null);
    }
  }

  async function reply() {
    const insight = data.insight;
    const text = question.trim();
    if (!insight || !text) return;
    setError(null);
    setAnswering({ question: text, answer: '' });
    try {
      const answer = await askFollowUp(data, today(), text, (so) => setAnswering({ question: text, answer: so }));
      onInsight({ ...insight, followUps: [...(insight.followUps ?? []), { question: text, answer }] });
      setQuestion('');
    } catch (e) {
      setError(e instanceof ClaudeError ? e.message : `Something went wrong: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAnswering(null);
    }
  }

  function clear() {
    const { insight: _, ...rest } = data;
    onChange(rest);
    setConfirmClear(false);
  }

  const shown = writing ?? data.insight?.text;
  const busy = writing !== null || answering !== null;
  const followUps = writing === null ? [...(data.insight?.followUps ?? []), ...(answering ? [answering] : [])] : [];

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
          to get insights from Dad.
        </p>
      ) : (
        <div className="actions insight-actions">
          <button
            className="primary"
            title="Sends Dad your monthly totals, balances, forecast, goals and the last three months of transactions (date, merchant, category and amount, not the full bank description)"
            disabled={busy || data.transactions.length === 0}
            onClick={review}
          >
            {writing !== null ? 'Writing…' : data.insight ? 'Get new insights' : 'Get insights'}
          </button>
          {data.insight &&
            !busy &&
            (confirmClear ? (
              <>
                <button className="danger" onClick={clear}>
                  Yes, clear it
                </button>
                <button onClick={() => setConfirmClear(false)}>Cancel</button>
              </>
            ) : (
              <button title="Remove this review and your replies to it" onClick={() => setConfirmClear(true)}>
                Clear
              </button>
            ))}
        </div>
      )}
      {data.insight && writing === null && data.anthropicKey && (
        <form
          className="reply"
          onSubmit={(e) => {
            e.preventDefault();
            reply();
          }}
        >
          <textarea
            rows={2}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                reply();
              }
            }}
            placeholder="Reply to clear up a point, e.g. The holiday in July was a one-off"
            aria-label="Reply to Dad"
          />
          <button type="submit" disabled={busy || !question.trim()}>
            {answering ? 'Sending…' : 'Send'}
          </button>
        </form>
      )}
      {shown !== undefined && (
        <div className="insight">
          {/* Newest first: your latest reply and Dad's answer at the top, the review itself at the bottom. */}
          {[...followUps].reverse().map((f, i) => (
            <div key={followUps.length - i} className="follow-up">
              <p className="question" aria-label="You said">
                {f.question}
              </p>
              {f.answer ? <Markdown text={f.answer} /> : <p className="muted">Dad is thinking…</p>}
            </div>
          ))}
          <div className={followUps.length ? 'review earlier' : 'review'}>
            {writing === null && data.insight && (
              <p className="muted small">
                Written{' '}
                {new Date(data.insight.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
            {shown ? <Markdown text={shown} /> : <p className="muted">Dad is looking at your figures…</p>}
          </div>
        </div>
      )}
      {error && <p className="warning">{error}</p>}
    </section>
  );
}
