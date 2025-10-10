-- Supabase schema for NISR Climate dashboard
-- Creates three tables used by the frontend: district_baselines, district_updates, district_alerts
-- Run this in the Supabase SQL editor or via psql connected to your Supabase Postgres DB.

-- 1) district_baselines: baseline values for each district (used to compare current conditions)
CREATE TABLE IF NOT EXISTS public.district_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  external_id text, -- optional external id/code used by your geojson or upstream systems
  latitude double precision,
  longitude double precision,
  avg_rainfall double precision,
  avg_temperature double precision,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2) district_updates: time-series of observed/ingested values (populated by the server-side job or the frontend)
CREATE TABLE IF NOT EXISTS public.district_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id uuid REFERENCES public.district_baselines(id) ON DELETE CASCADE,
  timestamp timestamptz NOT NULL,
  rainfall double precision,
  temperature double precision,
  humidity double precision,
  windspeed double precision,
  source text,
  raw jsonb,
  created_at timestamptz DEFAULT now()
);

-- 3) district_alerts: derived alerts
CREATE TABLE IF NOT EXISTS public.district_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id uuid REFERENCES public.district_baselines(id) ON DELETE CASCADE,
  timestamp timestamptz NOT NULL,
  severity text CHECK (severity IN ('low','medium','high')) DEFAULT 'low',
  details jsonb,
  created_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_district_updates_district_ts ON public.district_updates(district_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_district_ts ON public.district_alerts(district_id, timestamp DESC);

-- Trigger to keep updated_at in baselines
CREATE OR REPLACE FUNCTION public.updated_at_trigger()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at ON public.district_baselines;
CREATE TRIGGER set_updated_at
BEFORE UPDATE ON public.district_baselines
FOR EACH ROW
EXECUTE FUNCTION public.updated_at_trigger();

-- Sample data: you may replace the coordinates and values with real baselines
INSERT INTO public.district_baselines (id, name, external_id, latitude, longitude, avg_rainfall, avg_temperature)
VALUES
  (gen_random_uuid(), 'Kigali', 'KGL', -1.9441, 30.0619, 50, 22),
  (gen_random_uuid(), 'Huye', 'HUY', -2.6096, 29.7390, 80, 20)
ON CONFLICT DO NOTHING;

-- Example RLS policies (recommended):
-- 1) Enable Row Level Security and allow anonymous users to read baseline and alerts but NOT insert/update/delete
--    Adjust policies to your security requirements.
-- NOTE: Tailor RLS for your use case. The examples below are conservative and meant as a starting point.

-- Enable RLS
ALTER TABLE public.district_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.district_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.district_alerts ENABLE ROW LEVEL SECURITY;

-- Policy: allow anon (authenticated or anon role depending on your Supabase) to SELECT baselines and alerts
-- You can replace 'anon' with a custom policy using auth.role() checks or JWT claims.

CREATE POLICY "allow_select_baselines" ON public.district_baselines
FOR SELECT USING (true);

CREATE POLICY "allow_select_alerts" ON public.district_alerts
FOR SELECT USING (true);

-- Policy: restrict updates/inserts to a server-only role (e.g., service_role) — do NOT grant this to anon
CREATE POLICY "deny_modifications_from_anon_baselines" ON public.district_baselines
FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "deny_modifications_from_anon_updates" ON public.district_updates
FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "deny_modifications_from_anon_alerts" ON public.district_alerts
FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- If you want the frontend to be able to insert updates (less recommended), you can add a more permissive policy
-- Example: allow authenticated users to insert updates (but not modify others')
--
-- CREATE POLICY "insert_updates_for_authenticated" ON public.district_updates
-- FOR INSERT USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

