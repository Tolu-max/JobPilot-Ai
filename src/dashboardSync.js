/**
 * Pull dashboard decisions (approve/reject) from Supabase and stage them
 * for the local apply pipeline.
 *
 * Flow:
 *   1. Fetch job_applications where status in ('approved', 'rejected')
 *      for the current user, optionally scoped to this profile.
 *   2. Match each against the local store by job_hash or job_url.
 *   3. Flip local status:
 *        approved → pending_apply  (flushPendingApplyQueue applies it)
 *        rejected → skipped        (drops it from the review queue)
 *
 * Best-effort: silently no-ops without Supabase env vars, no auth, or no
 * matching local records. Local store stays the source of truth.
 */
import { loadAuth } from './cli/auth.js';
import { getUserSupabase } from './api/db.js';
import { getCachedProfileId } from './profileSync.js';
import { loadJobStore, saveJobStore } from './jobStore.js';
import { appendLog } from './logger.js';
import lockfile from 'proper-lockfile';

const REMOTE_TO_LOCAL = {
  approved: 'pending_apply',
  rejected: 'skipped'
};

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

export async function pullDashboardDecisions(config) {
  if (!hasSupabaseUrl() || !hasSupabaseAnonKey()) return { staged: 0, skipped: 0 };

  const auth = await loadAuth();
  if (!auth?.token) return { staged: 0, skipped: 0 };

  const userId = auth.user?.id || decodeJwtSub(auth.token);
  if (!userId) return { staged: 0, skipped: 0 };

  let decisions = [];
  try {
    const supabase = getUserSupabase(auth.token);
    let query = supabase
      .from('job_applications')
      .select('id, job_hash, job_url, title, status')
      .in('status', Object.keys(REMOTE_TO_LOCAL));

    const profileId = getCachedProfileId(userId, config.profileName);
    if (profileId) query = query.eq('profile_id', profileId);

    const { data, error } = await query;
    if (error) {
      await appendLog(`[dashboardSync] fetch error: ${error.message}`, config);
      return { staged: 0, skipped: 0 };
    }
    decisions = data || [];
  } catch (err) {
    await appendLog(`[dashboardSync] skipped: ${err.message}`, config);
    return { staged: 0, skipped: 0 };
  }

  if (decisions.length === 0) return { staged: 0, skipped: 0 };

  let release = () => {};
  try {
    release = await lockfile.lock(config.jobStorePath, { retries: 5, stale: 10000 });
    const store = await loadJobStore(config);
    let staged = 0;
    let skipped = 0;

    for (const remote of decisions) {
      const targetStatus = REMOTE_TO_LOCAL[remote.status];
      if (!targetStatus) continue;

      const local = store.jobs.find((j) =>
        (remote.job_hash && j.job_hash === remote.job_hash) ||
        (remote.job_url && j.job_url === remote.job_url)
      );

      if (!local) {
        await appendLog(`[dashboardSync] ${remote.status} job not in local store: ${remote.title} (${remote.job_url})`, config);
        continue;
      }

      // No-op if already in the target state or further along
      if (local.status === targetStatus) continue;
      if (['applied', 'failed'].includes(local.status)) continue;
      // Don't downgrade pending_apply just because remote also says approved
      if (local.status === 'pending_apply' && targetStatus === 'pending_apply') continue;

      local.status = targetStatus;
      local.updatedAt = new Date().toISOString();
      if (targetStatus === 'pending_apply') {
        local.acceptedViaDashboard = true;
        staged++;
      } else if (targetStatus === 'skipped') {
        local.rejectedViaDashboard = true;
        local.reason = local.reason || 'Rejected via dashboard';
        skipped++;
      }
    }

    if (staged > 0 || skipped > 0) {
      await saveJobStore(config, store);
      await appendLog(`[dashboardSync] staged ${staged} for apply, dropped ${skipped} rejected`, config);
    }
    return { staged, skipped };
  } catch (err) {
    await appendLog(`[dashboardSync] local merge error: ${err.message}`, config);
    return { staged: 0, skipped: 0 };
  } finally {
    await release();
  }
}

// Back-compat alias — pipeline.js still calls this name
export const pullDashboardApprovals = pullDashboardDecisions;

function hasSupabaseUrl() {
  return Boolean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
}

function hasSupabaseAnonKey() {
  return Boolean(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
