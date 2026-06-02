/**
 * Auth middleware — verifies Supabase JWTs.
 * Supabase issues a signed JWT when a user logs in.
 * We call supabase.auth.getUser(token) which validates
 * the signature and expiry against Supabase's servers.
 */
import { getSupabase } from '../db.js';

export async function authenticate(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) return respond401(res, 'Authentication required');

  try {
    const supabase = getSupabase();
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) return respond401(res, 'Invalid or expired token');

    // Attach user info to request for downstream handlers
    req.user       = user;
    req.userToken  = token;
    next();
  } catch (err) {
    console.error('[auth middleware]', err.message);
    return respond401(res, 'Token verification failed');
  }
}

function respond401(res, message) {
  if (!res.headersSent) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
  }
}
