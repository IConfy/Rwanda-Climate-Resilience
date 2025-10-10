Supabase setup for NISR Climate Dashboard

This README explains how to initialize the minimal Supabase schema used by the frontend and recommended security practices.

Files included
- supabase_schema.sql — SQL DDL that creates three tables: `district_baselines`, `district_updates`, and `district_alerts` plus indexes, sample data, and example RLS policy snippets.

Quick steps (Supabase Dashboard)
1. Open your Supabase project dashboard.
2. Go to "SQL Editor" → create a new query and paste the contents of `db/supabase_schema.sql`.
3. Run the query. It will create the tables and enable basic RLS policies.

Notes about the RLS examples in the SQL
- The example SQL enables Row-Level Security (RLS) on all three tables and adds a permissive SELECT policy for baselines and alerts (so the frontend can read them).
- It then adds conservative policies to deny modifications from non-service roles. The `service_role` is the special Supabase key intended for server-side usage only and should never be embedded in the browser.
- Adjust policies to your needs. For example, if you want the frontend to be able to insert `district_updates`, consider creating a policy that allows `authenticated` users to INSERT only (and validate payloads via `WITH CHECK`).

Recommended production setup
- Do NOT embed the Supabase `service_role` key in the browser. Use the anon key for client reads and RLS to enforce what clients can do.
- If you need server-side ingestion or background jobs that perform inserts/updates, run those tasks from a trusted environment (Cloud Function, server, or Supabase Edge Function) using the `service_role` key.
- Protect DDL and admin operations: only run them from your admin machine or CI pipeline.

Testing from the frontend
- The frontend already includes a minimal connectivity test. On load it tries a small `select('id').limit(1)` call on `district_baselines` and writes the result to the status area in the UI.
- If the test fails with a permissions error (HTTP 403/401), either:
  - Adjust RLS policies to permit the anon key the required action, or
  - Use server-side endpoints (Edge functions) to mediate writes.

Creating the tables from psql
- If you prefer CLI, download the connection string from Supabase and run:

  psql "<SUPABASE_DB_URL>" -f db/supabase_schema.sql

(Replace `<SUPABASE_DB_URL>` with the connection string shown in the Supabase UI.)

Useful links
- Supabase Row Level Security docs: https://supabase.com/docs/guides/auth/row-level-security
- Supabase Edge Functions: https://supabase.com/docs/guides/functions

If you want, I can also:
- Generate a Postgres `CREATE EXTENSION IF NOT EXISTS pgcrypto;` line in the SQL if gen_random_uuid() isn't available in your DB — or change the schema to use `uuid_generate_v4()` depending on your DB extensions.
- Add example server-side ingestion code (Node.js or Python) that uses the `service_role` key to insert `district_updates`.
- Add a small script to seed the tables with baselines matching your `data/locations.json` (mapping provinces->districts to baseline rows).

Tell me which of the above you'd like next and I'll implement it.
