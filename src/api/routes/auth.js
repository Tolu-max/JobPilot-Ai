/**
 * Auth routes — powered by Supabase Auth.
 *
 * Supabase handles:
 *   - Password hashing & storage
 *   - JWT issuance & signing
 *   - Session management & refresh tokens
 *   - Email confirmation (if enabled in Supabase dashboard)
 *
 * Our API is a thin wrapper so the CLI only needs to talk to us,
 * not directly to Supabase (keeps SUPABASE_URL private server-side).
 */
import { getSupabase } from '../db.js';
import { authenticate } from '../middleware/authMiddleware.js';

export function registerAuthRoutes(router) {
  router.post('/auth/register', handleRegister);
  router.post('/auth/login',    handleLogin);
  router.post('/auth/logout',   authenticate, handleLogout);
  router.post('/auth/refresh',  handleRefresh);
  router.get('/auth/me',        authenticate, handleMe);
}

// ---------------------------------------------------------------------------
// Register — creates a Supabase Auth user
// ---------------------------------------------------------------------------
async function handleRegister(req, res) {
  try {
    const { email, password, name = '' } = req.body || {};
    if (!email || !password) return badRequest(res, 'Email and password required');
    if (password.length < 8)  return badRequest(res, 'Password must be at least 8 characters');

    const supabase = getSupabase();

    const { data, error } = await supabase.auth.admin.createUser({
      email:         email.toLowerCase(),
      password,
      email_confirm: true,          // skip email confirmation (CLI flow)
      user_metadata: { name }
    });

    if (error) {
      // Supabase returns "User already registered" for duplicates
      const isDupe = /already registered|already exists/i.test(error.message);
      return res.writeHead(isDupe ? 409 : 400).end
        ? jsonError(res, isDupe ? 409 : 400, isDupe ? 'Email already registered' : error.message)
        : jsonError(res, isDupe ? 409 : 400, isDupe ? 'Email already registered' : error.message);
    }

    // Sign them in immediately to return a token
    const { data: session, error: signInErr } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase(), password
    });
    if (signInErr) return jsonError(res, 500, 'Account created but sign-in failed — try jobpilot login');

    jsonOk(res, 201, {
      token:         session.session.access_token,
      refresh_token: session.session.refresh_token,
      user: {
        id:    data.user.id,
        email: data.user.email,
        name:  data.user.user_metadata?.name || name,
        plan:  data.user.user_metadata?.plan || 'free'
      }
    });
  } catch (err) {
    console.error('[auth/register]', err.message);
    jsonError(res, 500, 'Registration failed');
  }
}

// ---------------------------------------------------------------------------
// Login — exchange email+password for a Supabase JWT
// ---------------------------------------------------------------------------
async function handleLogin(req, res) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return badRequest(res, 'Email and password required');

    const supabase = getSupabase();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase(), password
    });

    if (error || !data?.session) return jsonError(res, 401, 'Invalid email or password');

    jsonOk(res, 200, {
      token:         data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in:    data.session.expires_in,
      user: {
        id:    data.user.id,
        email: data.user.email,
        name:  data.user.user_metadata?.name || '',
        plan:  data.user.user_metadata?.plan || 'free'
      }
    });
  } catch (err) {
    console.error('[auth/login]', err.message);
    jsonError(res, 500, 'Login failed');
  }
}

// ---------------------------------------------------------------------------
// Logout — revoke the Supabase session
// ---------------------------------------------------------------------------
async function handleLogout(req, res) {
  try {
    const supabase = getSupabase();
    // Sign out the user from Supabase (invalidates their token server-side)
    await supabase.auth.admin.signOut(req.userToken);
    jsonOk(res, 200, { message: 'Logged out successfully' });
  } catch (err) {
    console.error('[auth/logout]', err.message);
    jsonError(res, 500, 'Logout failed');
  }
}

// ---------------------------------------------------------------------------
// Refresh — exchange refresh_token for a new access_token
// ---------------------------------------------------------------------------
async function handleRefresh(req, res) {
  try {
    const { refresh_token } = req.body || {};
    if (!refresh_token) return badRequest(res, 'refresh_token required');

    const supabase = getSupabase();
    const { data, error } = await supabase.auth.refreshSession({ refresh_token });
    if (error || !data?.session) return jsonError(res, 401, 'Invalid or expired refresh token');

    jsonOk(res, 200, {
      token:         data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in:    data.session.expires_in
    });
  } catch (err) {
    console.error('[auth/refresh]', err.message);
    jsonError(res, 500, 'Refresh failed');
  }
}

// ---------------------------------------------------------------------------
// Me — return current user info (token already verified by middleware)
// ---------------------------------------------------------------------------
async function handleMe(req, res) {
  const u = req.user;
  jsonOk(res, 200, {
    id:    u.id,
    email: u.email,
    name:  u.user_metadata?.name || '',
    plan:  u.user_metadata?.plan || 'free'
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function jsonOk(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function jsonError(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}

function badRequest(res, message) {
  return jsonError(res, 400, message);
}
