-- DEVELOPMENT / TESTING ONLY
-- Open permissions SQL for quick local testing. NOT FOR PRODUCTION.
-- This script disables Row Level Security (RLS) on the schema tables and grants the
-- PostgreSQL `public` role full SELECT/INSERT/UPDATE/DELETE privileges so the browser
-- anon key can freely read and write during dev/testing.

-- WARNING: Running this will make the tables fully writable by any role that can connect
-- to the DB (including the anon key if your Supabase project exposes it). Use only for
-- local/dev testing and revert to the RLS-enabled script before deploying.

-- Disable RLS (if previously enabled)
ALTER TABLE IF EXISTS public.district_baselines DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.district_updates DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.district_alerts DISABLE ROW LEVEL SECURITY;

-- Grant full privileges to the public role (development convenience)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.district_baselines TO public;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.district_updates TO public;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.district_alerts TO public;

-- Make sure sequences (if any) are accessible (for UUIDs this may not be necessary)
-- If you later add serial primary keys, consider granting usage on sequences to public.

-- Example: to allow anonymous frontend to insert updates during testing you may also
-- want to temporarily allow copying functions or triggers; the above grants table DML.

-- To undo these changes (re-lock for production) run the original RLS enabling/GRANT removal:
-- ALTER TABLE public.district_baselines ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.district_updates ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.district_alerts ENABLE ROW LEVEL SECURITY;
-- REVOKE ALL ON TABLE public.district_baselines FROM public;
-- REVOKE ALL ON TABLE public.district_updates FROM public;
-- REVOKE ALL ON TABLE public.district_alerts FROM public;

