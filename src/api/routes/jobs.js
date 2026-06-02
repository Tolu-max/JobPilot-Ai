/**
 * Jobs / queue routes — read & update job_applications on behalf of the user.
 *
 * All routes are auth-protected. Queries use the user's JWT so RLS scopes
 * results to that user automatically.
 *
 *   GET  /jobs            ?status=approved&limit=50&profile=tolu  → list user's jobs
 *   GET  /jobs/:id                                                → fetch one job
 *   PUT  /jobs/:id        { status, reason? }                     → update status
 *   GET  /queue           shorthand for status=reviewed,approved,pending_apply
 */
import { authenticate } from '../middleware/authMiddleware.js';
import { getUserSupabase } from '../db.js';

const ALLOWED_STATUS = new Set([
  'pending', 'reviewed', 'approved', 'rejected', 'pending_apply',
  'applied', 'failed', 'skipped', 'duplicate', 'manual_review', 'ignored'
]);

const QUEUE_STATUSES = ['reviewed', 'approved', 'pending_apply'];

export function registerJobsRoutes(router) {
  router.get('/jobs',      authenticate, handleListJobs);
  router.get('/jobs/:id',  authenticate, handleGetJob);
  router.put('/jobs/:id',  authenticate, handleUpdateJob);
  router.get('/queue',     authenticate, handleQueue);
}

// ---------------------------------------------------------------------------
// GET /jobs?status=&limit=&profile=
// ---------------------------------------------------------------------------
async function handleListJobs(req, res) {
  try {
    const supabase = getUserSupabase(req.userToken);
    const limit = clampInt(req.query.limit, 1, 200, 50);

    let query = supabase
      .from('job_applications')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (req.query.status) {
      const statuses = req.query.status.split(',').map(s => s.trim()).filter(s => ALLOWED_STATUS.has(s));
      if (statuses.length === 0) return jsonError(res, 400, 'Invalid status filter');
      query = statuses.length === 1 ? query.eq('status', statuses[0]) : query.in('status', statuses);
    }

    if (req.query.profile) {
      // Resolve profile_name → profile_id, then filter
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('profile_name', req.query.profile)
        .single();
      if (profile?.id) query = query.eq('profile_id', profile.id);
      else return jsonOk(res, 200, { jobs: [] });
    }

    const { data, error } = await query;
    if (error) return jsonError(res, 500, error.message);
    jsonOk(res, 200, { jobs: data || [] });
  } catch (err) {
    console.error('[jobs/list]', err.message);
    jsonError(res, 500, 'Failed to list jobs');
  }
}

// ---------------------------------------------------------------------------
// GET /jobs/:id
// ---------------------------------------------------------------------------
async function handleGetJob(req, res) {
  try {
    const supabase = getUserSupabase(req.userToken);
    const { data, error } = await supabase
      .from('job_applications')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error || !data) return jsonError(res, 404, 'Job not found');
    jsonOk(res, 200, data);
  } catch (err) {
    console.error('[jobs/get]', err.message);
    jsonError(res, 500, 'Failed to fetch job');
  }
}

// ---------------------------------------------------------------------------
// PUT /jobs/:id  { status, reason? }
// ---------------------------------------------------------------------------
async function handleUpdateJob(req, res) {
  try {
    const { status, reason } = req.body || {};
    if (!status) return jsonError(res, 400, 'status required');
    if (!ALLOWED_STATUS.has(status)) return jsonError(res, 400, `Invalid status: ${status}`);

    const supabase = getUserSupabase(req.userToken);
    const patch = {
      status,
      updated_at: new Date().toISOString(),
      ...(reason ? { reason } : {}),
      ...(status === 'applied' ? { applied_at: new Date().toISOString() } : {})
    };

    const { data, error } = await supabase
      .from('job_applications')
      .update(patch)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) return jsonError(res, 500, error.message);
    if (!data)  return jsonError(res, 404, 'Job not found');
    jsonOk(res, 200, data);
  } catch (err) {
    console.error('[jobs/update]', err.message);
    jsonError(res, 500, 'Failed to update job');
  }
}

// ---------------------------------------------------------------------------
// GET /queue — shortcut for the CLI's "what should I act on" poll
// ---------------------------------------------------------------------------
async function handleQueue(req, res) {
  try {
    const supabase = getUserSupabase(req.userToken);
    const limit = clampInt(req.query.limit, 1, 200, 50);

    let query = supabase
      .from('job_applications')
      .select('*')
      .in('status', QUEUE_STATUSES)
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (req.query.profile) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('profile_name', req.query.profile)
        .single();
      if (profile?.id) query = query.eq('profile_id', profile.id);
      else return jsonOk(res, 200, { jobs: [] });
    }

    const { data, error } = await query;
    if (error) return jsonError(res, 500, error.message);
    jsonOk(res, 200, { jobs: data || [] });
  } catch (err) {
    console.error('[queue]', err.message);
    jsonError(res, 500, 'Failed to fetch queue');
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function jsonOk(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function jsonError(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}
