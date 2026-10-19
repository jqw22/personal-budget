import { ClaudeError, FALLBACK_BETA, MODEL, poundsAndPence, replyText, withClaude } from './claude';
import { impliedOpeningBalance } from './export';
import { categoryHistory, closingBalances, forecastAfter, monthsWithData, UNTAGGED } from './summary';
import type { BudgetData } from './types';

/** How many months of actual figures Claude is shown, ending at the latest. */
const MONTHS_REVIEWED = 6;
/** How many of those months Claude also sees each transaction for. */
const MONTHS_OF_TRANSACTIONS = 3;

const pounds = (pence: number) => Math.round(pence / 100);

/**
 * What Claude is sent: monthly totals per category, balances, the forecast and
 * the goals, in whole pounds, and the last few months' transactions as date,
 * short merchant name, category and amount. Full bank descriptions, which
 * carry references and account details, stay on the device.
 */
export function reviewData(data: BudgetData, today: string) {
  const months = monthsWithData(data.transactions);
  const latest = months.at(-1);
  if (!latest) return null;
  const withData = new Set(months);
  const history = categoryHistory(data.transactions, latest, MONTHS_REVIEWED);
  const essential = data.essential ?? [];
  const opening = data.openingBalance ?? impliedOpeningBalance(data.transactions);
  const closing = opening === null ? null : closingBalances(data.transactions, opening, history.months);
  const forecast = forecastAfter(history, data.forecast, closing?.at(-1) ?? null);
  const typeOf = (category: string) =>
    category === UNTAGGED ? 'untagged' : essential.includes(category) ? 'essential' : 'discretionary';
  // Left out of income and spending, but it moves the balance, so Claude needs it to make sense of it.
  const untaggedIn = (month: string) =>
    data.transactions.filter((t) => !t.category && t.amount > 0 && t.date.startsWith(month)).reduce((total, t) => total + t.amount, 0);
  const latestDates = data.transactions.filter((t) => t.date.startsWith(latest)).map((t) => t.date);

  return {
    today,
    currency: 'GBP, whole pounds',
    latestMonth: { month: latest, firstDate: latestDates[0], lastDate: latestDates.at(-1) },
    categories: Object.fromEntries(history.rows.map((r) => [r.category, typeOf(r.category)])),
    actual: history.months
      .map((month, i) => ({
        month,
        income: pounds(history.income[i]),
        spending: Object.fromEntries(history.rows.filter((r) => r.amounts[i]).map((r) => [r.category, pounds(r.amounts[i])])),
        totalSpending: pounds(history.totals[i]),
        untaggedMoneyIn: pounds(untaggedIn(month)),
        ...(closing ? { closingBalance: pounds(closing[i]) } : {}),
      }))
      .filter((m) => withData.has(m.month)),
    yearToDate: {
      monthsWithData: history.ytd.months,
      income: pounds(history.ytd.income),
      spending: pounds(history.ytd.total),
    },
    forecast: forecast.months.map((month, i) => ({
      month,
      income: pounds(forecast.income[i]),
      spending: Object.fromEntries(forecast.rows.filter((r) => r.amounts[i]).map((r) => [r.category, pounds(r.amounts[i])])),
      totalSpending: pounds(forecast.totals[i]),
      ...(forecast.closing.length ? { closingBalance: pounds(forecast.closing[i]) } : {}),
      setByUser: Object.keys(data.forecast?.[month] ?? {}),
    })),
    goals: (data.goals ?? []).map((g) => g.text),
    ...(data.insight?.followUps?.length ? { notesFromLastReview: data.insight.followUps.map((f) => f.question) } : {}),
    transactionsColumns: 'date|merchant|category|amount in pounds (negative is money out)',
    transactions: data.transactions
      .filter((t) => t.date.slice(0, 7) >= history.months[history.months.length - MONTHS_OF_TRANSACTIONS])
      .map((t) => [t.date, t.merchant, t.category ?? UNTAGGED, poundsAndPence(t.amount)].join('|')),
  };
}

const SYSTEM = `You review a UK household's monthly budget and help them reach their financial goals. In this app you are called Dad.

You are given monthly totals by category (amounts in whole pounds), closing bank balances, a forecast for the coming months, the user's goals and every transaction from the last three months. Use the transactions to find what to change: name the merchants, subscriptions and recurring payments, and tell one-offs from habits. Categories are essential, discretionary or untagged. Transfers between their own accounts are left out, and so is untagged money coming in (untaggedMoneyIn), though both move the balance. The forecast uses each category's monthly average this year unless the user typed in their own figure (listed in setByUser). The latest month may be incomplete: compare its dates with today and don't treat a part month as a drop in spending.

Write in plain British English, speaking to the user as "you". Comment only on their goals and what to change. Don't describe what changed from month to month or how spending is trending, except as a brief reason for a suggestion. Use these two Markdown sections, each with a "## " heading:

## Your goals
For each goal, whether the forecast gets there and by when, with the arithmetic in brief. If there are no goals, say what the forecast balance trend means and suggest setting one.

## What to change
Two or three specific changes, naming merchants or subscriptions where that helps, each with its impact in pounds a month and by the goal's date. Prefer discretionary spending; be realistic about essentials.

Keep it under 300 words. Use short paragraphs and bullet points, no tables. Don't add disclaimers or recommend specific financial products.

If notesFromLastReview is given, those are things the user told you about your previous review, such as a payment being a one-off: take them into account.

After the review, the user may reply to clear up a point or ask a question. Answer briefly in plain Markdown without the two sections. If they correct something, say what it changes about your conclusions and the numbers.`;

type MessageParam = { role: 'user' | 'assistant'; content: string };

/**
 * Asks Claude for a review. `onText` receives the review as it's written.
 */
export async function getInsights(data: BudgetData, today: string, onText: (text: string) => void): Promise<string> {
  return converse(data, today, [], onText);
}

/** Asks Claude about its last review, with the conversation so far. `onText` receives the answer as it's written. */
export async function askFollowUp(data: BudgetData, today: string, question: string, onText: (text: string) => void): Promise<string> {
  const insight = data.insight;
  if (!insight) throw new ClaudeError('Ask Dad first.');
  const turns: MessageParam[] = [{ role: 'assistant', content: insight.text }];
  for (const f of insight.followUps ?? []) turns.push({ role: 'user', content: f.question }, { role: 'assistant', content: f.answer });
  turns.push({ role: 'user', content: question });
  // The review was written from the data as it was then, without the notes this conversation produces.
  return converse({ ...data, insight: { ...insight, followUps: [] } }, today, turns, onText);
}

async function converse(data: BudgetData, today: string, turns: MessageParam[], onText: (text: string) => void): Promise<string> {
  const review = reviewData(data, today);
  if (!review) throw new ClaudeError('Import some transactions first.');
  return withClaude(data, async (client) => {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      system: SYSTEM,
      messages: [{ role: 'user', content: `Here is my budget:\n\n${JSON.stringify(review, null, 1)}` }, ...turns],
    });
    let text = '';
    stream.on('text', (delta) => {
      text += delta;
      onText(text);
    });
    return replyText(await stream.finalMessage());
  });
}
