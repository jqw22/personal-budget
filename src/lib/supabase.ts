import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChunkRow, ChunkStore } from './cloud';
import { SUPABASE_KEY, SUPABASE_URL } from './supabaseConfig';

export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);

const TABLE = 'budget_chunks';

let client: Promise<SupabaseClient> | null = null;

/** The Supabase client, loaded on first use. It keeps the sign-in in this browser and finishes one from a sign-in link. */
export function supabase(): Promise<SupabaseClient> {
  client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
    }),
  );
  return client;
}

/** The signed-in user's rows of the budget_chunks table. */
export function chunkStore(db: SupabaseClient, userId: string): ChunkStore {
  return {
    async fetch(since) {
      let query = db.from(TABLE).select('d, body, updated_at').order('updated_at');
      if (since) query = query.gt('updated_at', since);
      const { data, error } = await query;
      if (error) throw new Error(`Couldn't load from Supabase: ${error.message}`);
      return data as ChunkRow[];
    },
    async upsert(rows) {
      const { data, error } = await db
        .from(TABLE)
        .upsert(rows.map((row) => ({ user_id: userId, ...row })), { onConflict: 'user_id,d' })
        .select('d, body, updated_at');
      if (error) throw new Error(`Couldn't save to Supabase: ${error.message}`);
      return data as ChunkRow[];
    },
  };
}
