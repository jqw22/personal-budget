import { impliedOpeningBalance } from './export';
import { categoryHistory, closingBalances, forecastAfter, monthsWithData, UNTAGGED } from './summary';
import type { BudgetData } from './types';

/** How many months of actual figures Claude is shown, ending at the latest. */
const MONTHS_REVIEWED = 6;
const MODEL = 'claude-opus-5-5';

const pounds = (pence: number) => Math.round(pence / 100);

/**
 * What Claude is sent: monthly totals per category, balances, the forecast and
 * the goals, in whole pounds. No transaction descriptions, payees or dates of
 * single transactions leave the device.
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
  };
}

const SYSTEM = `You review a UK household's monthly budget and help them reach their financial goals.

You are given monthly totals by category (amounts in whole pounds), closing bank balances, a forecast for the coming months and the user's goals. Categories are essential, discretionary or untagged. Transfers between their own accounts are left out, and so is untagged money coming in (untaggedMoneyIn), though both move the balance. The forecast uses each category's monthly average this year unless the user typed in their own figure (listed in setByUser). The latest month may be incomplete: compare its dates with today and don't treat a part month as a drop in spending.

Write in plain British English, speaking to the user as "you". Use these four Markdown sections, each with a "## " heading:

## What changed
The latest complete month against the months before: the two or three movements that matter, with amounts.

## Creeping up
Discretionary categories trending upwards over several months, with the monthly amounts. Say so plainly if nothing is.

## Your goals
For each goal, whether the forecast gets there and by when, with the arithmetic in brief. If there are no goals, say what the forecast balance trend means and suggest setting one.

## What to change
Two or three specific changes, each with its impact in pounds a month and by the goal's date. Prefer discretionary spending; be realistic about essentials.

Keep it under 350 words. Use short paragraphs and bullet points, no tables. Don't add disclaimers or recommend specific financial products.`;

export class InsightError extends Error {}

/**
 * Asks Claude for a review, calling the API straight from the browser with the
 * user's own key. `onText` receives the review as it's written.
 */
export async function getInsights(data: BudgetData, today: string, onText: (text: string) => void): Promise<string> {
  const review = reviewData(data, today);
  if (!review) throw new InsightError('Import some transactions first.');
  if (!data.anthropicKey) throw new InsightError('Add your Anthropic API key in Account first.');
  // Loaded only when asked for, so the app opens just as fast for everyone else.
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: data.anthropicKey, dangerouslyAllowBrowser: true });
  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      messages: [{ role: 'user', content: `Here is my budget:\n\n${JSON.stringify(review, null, 1)}` }],
    });
    let text = '';
    stream.on('text', (delta) => {
      text += delta;
      onText(text);
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') throw new InsightError("Claude couldn't write a review this time. Try again.");
    const final = message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    if (!final.trim()) throw new InsightError('Claude sent back an empty review. Try again.');
    return final;
  } catch (e) {
    if (e instanceof InsightError) throw e;
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      throw new InsightError("Your Anthropic API key wasn't accepted. Check it in Account.");
    }
    if (e instanceof Anthropic.RateLimitError) throw new InsightError('Too many requests just now. Wait a minute and try again.');
    if (e instanceof Anthropic.APIConnectionError) throw new InsightError("Couldn't reach Claude. Check your connection and try again.");
    if (e instanceof Anthropic.APIError) {
      const credit = /credit balance/i.test(e.message);
      throw new InsightError(credit ? 'Your Anthropic account is out of credit. Top it up at console.anthropic.com.' : `Claude returned an error: ${e.message}`);
    }
    throw e;
  }
}
