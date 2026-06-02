/**
 * Best-effort job application sync to Supabase.
 *
 * Local SQLite/JSON remains the source of truth. Supabase sync only runs when
 * the CLI has a logged-in user token or when service-role sync is explicitly
 * configured with SUPABASE_USER_ID.
 */
import { getSupabase, getUserSupabase } from './api/db.js';
import { loadAuth } from './cli/auth.js';
import { appendLog } from './logger.js';
import { syncProfileToSupabase } from './profileSync.js';

export async function syncJobApplicationsBatch(jobs, config) {
  if (!jobs || jobs.length === 0) {
    return { synced: 0, failed: 0 };
  }

  const context = await resolveSupabaseContext(config);
  if (!context) {
    return { synced: 0, failed: 0 };
  }

  try {
    const records = jobs.map((job) => ({
      user_id: context.userId,
      profile_id: context.profileId || null,
      job_hash: job.job_hash,
      title: job.title || null,
      company: job.company || null,
      source_site: job.source_site || null,
      job_url: job.job_url || job.applicationUrl || null,
      status: mapLocalStatusToSupabase(job.status),
      score: job.score ?? job.local?.score ?? null,
      applied_at: job.status === 'applied' ? (job.updatedAt || new Date().toISOString()) : null,
    }));

    const { error } = await context.supabase
      .from('job_applications')
      .upsert(records, { onConflict: 'user_id,job_hash' });

    if (error) {
      await appendLog(`[Supabase] sync error: ${error.message}`, config);
      return { synced: 0, failed: jobs.length };
    }

    await appendLog(`[Supabase] synced ${jobs.length} job applications`, config);
    return { synced: jobs.length, failed: 0 };
  } catch (err) {
    await appendLog(`[Supabase] sync failed: ${err.message}`, config);
    return { synced: 0, failed: jobs.length };
  }
}

async function resolveSupabaseContext(config) {
  const authContext = await resolveUserAuthContext(config);
  if (authContext) return authContext;

  const serviceContext = resolveServiceRoleContext();
  if (serviceContext) return serviceContext;

  return null;
}

async function resolveUserAuthContext(config) {
  const hasUserClientEnv = hasSupabaseUrl() && hasSupabaseAnonKey();
  if (!hasUserClientEnv) return null;

  const auth = await loadAuth().catch(() => null);
  if (!auth?.token) return null;

  const userId = auth.user?.id || decodeJwtSub(auth.token);
  if (!isUuid(userId)) return null;

  const profileId = await syncProfileToSupabase(config).catch(() => null);
  return {
    supabase: getUserSupabase(auth.token),
    userId,
    profileId,
  };
}

function resolveServiceRoleContext() {
  if (!hasSupabaseUrl() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;

  const userId = process.env.SUPABASE_USER_ID || process.env.JOBPILOT_SUPABASE_USER_ID || '';
  if (!isUuid(userId)) return null;

  return {
    supabase: getSupabase(),
    userId,
    profileId: isUuid(process.env.SUPABASE_PROFILE_ID) ? process.env.SUPABASE_PROFILE_ID : null,
  };
}

function hasSupabaseUrl() {
  return Boolean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
}

function hasSupabaseAnonKey() {
  return Boolean(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

function decodeJwtSub(token) {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json).sub || null;
  } catch {
    return null;
  }
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function mapLocalStatusToSupabase(localStatus) {
  const statusMap = {
    applied: 'applied',
    ignored: 'skipped',
    duplicate: 'skipped',
    reviewed: 'reviewed',
    manual_review: 'reviewed',
    pending_apply: 'pending_apply',
    failed: 'failed',
    skipped: 'skipped',
    rejected: 'rejected',
  };
  return statusMap[localStatus] || 'pending';
}
