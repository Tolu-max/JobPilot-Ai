-- JobPilot Supabase PostgreSQL Schema
-- Run once via Supabase SQL editor or CLI:
--   supabase db push   (if using supabase CLI)
--   or paste into: https://app.supabase.com → SQL Editor

-- NOTE: Supabase manages the `auth.users` table automatically.
-- We reference it with auth.uid() in RLS policies.

-- ── Profiles ─────────────────────────────────────────────────────────────
-- Each user can have one or more job-hunting profiles (e.g. "tolu", "sister")
CREATE TABLE IF NOT EXISTS public.profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  profile_name  TEXT NOT NULL,
  display_name  TEXT NOT NULL DEFAULT '',
  email         TEXT,
  role_summary  TEXT,
  min_score     INT NOT NULL DEFAULT 70,
  auto_apply    BOOLEAN NOT NULL DEFAULT FALSE,
  enabled_sites JSONB NOT NULL DEFAULT '[]',
  config        JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, profile_name)
);

-- ── Job Applications ──────────────────────────────────────────────────────
-- Mirror of the local processedJobs.json — synced for analytics & history
CREATE TABLE IF NOT EXISTS public.job_applications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  profile_id   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  job_hash     TEXT NOT NULL,
  title        TEXT,
  company      TEXT,
  source_site  TEXT,
  job_url      TEXT,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending|applied|failed|skipped|reviewed
  score        INT,
  applied_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, job_hash)
);

-- ── Indexes ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_profiles_user        ON public.profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_user_status     ON public.job_applications(user_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_user_hash       ON public.job_applications(user_id, job_hash);
CREATE INDEX IF NOT EXISTS idx_jobs_source_site     ON public.job_applications(source_site);

-- ── Row Level Security ────────────────────────────────────────────────────
-- Users can only see and edit their own data

ALTER TABLE public.profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_applications ENABLE ROW LEVEL SECURITY;

-- Profiles: user owns their own rows
CREATE POLICY "profiles: owner access" ON public.profiles
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Job applications: user owns their own rows
CREATE POLICY "jobs: owner access" ON public.job_applications
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── Auto-update updated_at ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE OR REPLACE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER jobs_updated_at
  BEFORE UPDATE ON public.job_applications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
