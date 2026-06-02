/**
 * CLI auth helpers — stores Supabase tokens in ~/.jobpilot/auth.json
 * The CLI calls our backend API, which wraps Supabase Auth.
 * The backend returns a Supabase JWT (access_token) + refresh_token.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const CONFIG_DIR = path.join(os.homedir(), '.jobpilot');
const AUTH_FILE  = path.join(CONFIG_DIR, 'auth.json');
const API_BASE   = process.env.JOBPILOT_API_URL || 'http://localhost:4000';
const API_TIMEOUT_MS = Number(process.env.JOBPILOT_API_TIMEOUT_MS || 15000);

export class ApiError extends Error {
  constructor(message, { status = null, code = 'api_error', cause = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Token storage
// ---------------------------------------------------------------------------

export async function saveAuth(token, refreshToken, user) {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(AUTH_FILE, JSON.stringify({
    token,
    refresh_token: refreshToken,
    user,
    savedAt: new Date().toISOString()
  }, null, 2), 'utf-8');
}

export async function loadAuth() {
  try {
    const raw = await fs.readFile(AUTH_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function clearAuth() {
  try { await fs.unlink(AUTH_FILE); } catch { /* already gone */ }
}

/**
 * Returns a valid access token, refreshing automatically if expired.
 * Supabase JWTs expire after 1 hour by default.
 */
export async function getValidToken() {
  const auth = await loadAuth();
  if (!auth?.token) return null;

  // Check if token is close to expiry (try refresh if > 55 mins old)
  const savedAt   = new Date(auth.savedAt).getTime();
  const ageMinutes = (Date.now() - savedAt) / 60000;

  if (ageMinutes > 55 && auth.refresh_token) {
    try {
      const data = await apiRequest('POST', '/auth/refresh', { refresh_token: auth.refresh_token });
      await saveAuth(data.token, data.refresh_token, auth.user);
      return data.token;
    } catch {
      // Refresh failed — token might still work, return it anyway
    }
  }

  return auth.token;
}

export async function requireAuth() {
  const auth = await loadAuth();
  if (!auth?.token) {
    if (!authRequired()) {
      return {
        token: null,
        user: { email: 'local@jobpilot.dev' },
        localMode: true,
        savedAt: new Date().toISOString()
      };
    }
    console.error('  \x1b[91mX\x1b[0m  Not logged in. Run: jobpilot login');
    process.exit(1);
  }
  return auth;
}

export function authRequired() {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.JOBPILOT_REQUIRE_AUTH || '').toLowerCase());
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

export async function apiRequest(method, endpoint, body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  const options = { method, headers, signal: controller.signal };
  if (body) options.body = JSON.stringify(body);

  let response;
  try {
    response = await fetch(`${API_BASE}${endpoint}`, options);
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new ApiError(`API request timed out after ${Math.round(API_TIMEOUT_MS / 1000)}s`, {
        code: 'timeout',
        cause: err
      });
    }
    throw new ApiError('Could not reach the JobPilot API. Check your connection and try again.', {
      code: 'network',
      cause: err
    });
  } finally {
    clearTimeout(timeout);
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiError(data.error || `API error ${response.status}`, {
      status: response.status,
      code: response.status === 401 ? 'unauthorized' : 'http_error'
    });
  }
  return data;
}

export async function apiLogin(email, password) {
  const data = await apiRequest('POST', '/auth/login', { email, password });
  await saveAuth(data.token, data.refresh_token, data.user);
  return data;
}

export async function apiRegister(email, password, name) {
  const data = await apiRequest('POST', '/auth/register', { email, password, name });
  await saveAuth(data.token, data.refresh_token, data.user);
  return data;
}

export async function apiMe() {
  const token = await getValidToken();
  return apiRequest('GET', '/auth/me', null, token);
}

export async function apiLogout() {
  const token = await getValidToken();
  await apiRequest('POST', '/auth/logout', null, token).catch(() => {});
  await clearAuth();
}
