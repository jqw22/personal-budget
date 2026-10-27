# Saving the budget to Supabase

The app can save your budget to a Supabase project as well as, or instead of,
Nostr relays. You sign in with your email, and each device you sign in on gets
the same budget.

## Setting up the project

1. Create a free project at <https://supabase.com/dashboard/new>. Any name and
   database password will do; pick the region nearest you (London is
   `eu-west-2`).
2. Open the project's SQL editor, paste in [`schema.sql`](schema.sql) and run it.
   This makes the `budget_chunks` table and its row level security, so each
   signed-in user can only read and change their own rows.
3. Under **Authentication → URL Configuration**, set the Site URL to
   `https://jqw22.github.io/personal-budget/` and add the same address to the
   Redirect URLs, so sign-in links come back to the app.
4. Under **Project Settings → API Keys**, copy the publishable (anon) key, and
   the Project URL from **Project Settings → Data API**. Put both in
   [`src/lib/supabaseConfig.ts`](../src/lib/supabaseConfig.ts). They're safe to
   publish: without a signed-in user they can't read anything.

## How it's stored

The budget is saved as the same parts that go to Nostr: one row for
categories, rules and settings, and one or more rows per month of
transactions, each as JSON text. Saving only sends the parts that changed, and
an open app looks for other devices' saves every minute and when you come back
to it.

Free Supabase projects pause after a week without use. Nothing is lost: restore
the project from the dashboard and sign in again.
