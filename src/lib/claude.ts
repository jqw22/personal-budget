import type Anthropic from '@anthropic-ai/sdk';
import type { BudgetData } from './types';

export const MODEL = 'claude-opus-5-5';
/** Retries on a stand-in model, server side, if the requested one declines. */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** A problem worth showing the user as it is. */
export class ClaudeError extends Error {}

/**
 * Runs `call` with a client using the user's own key, calling the API straight
 * from the browser, and turns API failures into messages the user can act on.
 */
export async function withClaude<T>(data: BudgetData, call: (client: Anthropic) => Promise<T>): Promise<T> {
  if (!data.anthropicKey) throw new ClaudeError('Add your Anthropic API key in Account first.');
  // Loaded only when asked for, so the app opens just as fast for everyone else.
  const { default: Client } = await import('@anthropic-ai/sdk');
  const client = new Client({ apiKey: data.anthropicKey, dangerouslyAllowBrowser: true });
  try {
    return await call(client);
  } catch (e) {
    if (e instanceof ClaudeError) throw e;
    if (e instanceof Client.AuthenticationError || e instanceof Client.PermissionDeniedError) {
      throw new ClaudeError("Your Anthropic API key wasn't accepted. Check it in Account.");
    }
    if (e instanceof Client.RateLimitError) throw new ClaudeError('Too many requests just now. Wait a minute and try again.');
    if (e instanceof Client.APIConnectionError) throw new ClaudeError("Couldn't reach Dad. Check your connection and try again.");
    if (e instanceof Client.APIError) {
      const credit = /credit balance/i.test(e.message);
      throw new ClaudeError(credit ? 'Your Anthropic account is out of credit. Top it up at console.anthropic.com.' : `Dad returned an error: ${e.message}`);
    }
    throw e;
  }
}

/** The text of a finished reply, or a ClaudeError if Claude declined or sent nothing. */
export function replyText(message: Anthropic.Beta.BetaMessage): string {
  if (message.stop_reason === 'refusal') throw new ClaudeError("Dad declined this time. Try again.");
  const text = message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  if (!text.trim()) throw new ClaudeError('Dad sent back an empty reply. Try again.');
  return text;
}

/** "-12.5" style amounts in pounds and pence, for the rows Claude is shown. */
export function poundsAndPence(pence: number): string {
  return (pence / 100).toFixed(2);
}
