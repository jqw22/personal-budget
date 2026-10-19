import { FALLBACK_BETA, MODEL, poundsAndPence, replyText, withClaude, ClaudeError } from './claude';
import { NOT_SPENDING } from './summary';
import type { BudgetData } from './types';

/** Most merchants asked about at once, most frequent first. */
const MAX_MERCHANTS = 150;
/** Most existing rules shown to Claude as examples of how this user tags. */
const MAX_EXAMPLES = 100;

export interface UntaggedMerchant {
  merchant: string;
  count: number;
  /** The middle amount, in pence: negative for money out. */
  typical: number;
}

export interface TagSuggestion extends UntaggedMerchant {
  /** One of the user's categories, or null when Claude can't tell. */
  category: string | null;
}

/** Each merchant with untagged transactions, most transactions first. */
export function untaggedMerchants(data: BudgetData): UntaggedMerchant[] {
  const amounts = new Map<string, number[]>();
  for (const t of data.transactions) if (!t.category) amounts.set(t.merchant, [...(amounts.get(t.merchant) ?? []), t.amount]);
  return [...amounts]
    .map(([merchant, list]) => ({ merchant, count: list.length, typical: [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)] }))
    .sort((a, b) => b.count - a.count || a.merchant.localeCompare(b.merchant));
}

/** What Claude is sent: merchant names, how often and how much, the categories and the user's own rules. */
export function tagRequest(data: BudgetData, merchants: UntaggedMerchant[]) {
  const essential = data.essential ?? [];
  return {
    categories: Object.fromEntries(
      data.categories.map((c) => [c, NOT_SPENDING.includes(c) ? 'not spending' : essential.includes(c) ? 'essential' : 'discretionary']),
    ),
    examples: data.rules.slice(0, MAX_EXAMPLES).map((r) => `${r.match} → ${r.category}`),
    merchantsColumns: 'merchant|transactions|typical amount in pounds (negative is money out)',
    merchants: merchants.map((m) => [m.merchant, m.count, poundsAndPence(m.typical)].join('|')),
  };
}

const SYSTEM = `You tag a UK household's bank transactions with spending categories.

You are given the user's categories, examples of merchants they have already tagged, and merchants that are still untagged, each with how many transactions it has and a typical amount. For each untagged merchant, pick the category the user would most likely choose, following their examples. Money coming in is usually Income or Transfers. Payments to and from people, or the user's own accounts, are usually Transfers unless the examples show otherwise. If you can't tell with reasonable confidence, use an empty string.`;

/** Asks Claude to suggest a category for each untagged merchant. */
export async function suggestTags(data: BudgetData): Promise<TagSuggestion[]> {
  const merchants = untaggedMerchants(data).slice(0, MAX_MERCHANTS);
  if (merchants.length === 0) throw new ClaudeError('Everything is already tagged.');
  const schema = {
    type: 'object',
    properties: {
      suggestions: {
        type: 'array',
        items: {
          type: 'object',
          properties: { merchant: { type: 'string' }, category: { type: 'string', enum: [...data.categories, ''] } },
          required: ['merchant', 'category'],
          additionalProperties: false,
        },
      },
    },
    required: ['suggestions'],
    additionalProperties: false,
  };
  const reply = await withClaude(data, async (client) =>
    replyText(
      await client.beta.messages
        .stream({
          model: MODEL,
          max_tokens: 16000,
          thinking: { type: 'adaptive' },
          output_config: { effort: 'low', format: { type: 'json_schema', schema } },
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
          system: SYSTEM,
          messages: [{ role: 'user', content: JSON.stringify(tagRequest(data, merchants), null, 1) }],
        })
        .finalMessage(),
    ),
  );
  let picked: Map<string, string>;
  try {
    const parsed = JSON.parse(reply) as { suggestions: { merchant: string; category: string }[] };
    picked = new Map(parsed.suggestions.map((s) => [s.merchant, s.category]));
  } catch {
    throw new ClaudeError("Dad's reply couldn't be read. Try again.");
  }
  return merchants.map((m) => {
    const category = picked.get(m.merchant);
    return { ...m, category: category && data.categories.includes(category) ? category : null };
  });
}
