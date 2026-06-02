/**
 * Syncs the active CLI profile to Supabase's public.profiles table.
 * Returns the profile row id so jobStore can stamp profile_id on jobs.
 *
 * Best-effort: silently no-ops without Supabase env vars or auth token,
 * so local-only users and tests never break.
 */
import { loadAuth } from './cli/auth.js';
import { getUserSupabase } from './api/db.js';

const cache = new Map(); // key: `${userId}::${profileName}` -> profile row id

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

export async function syncProfileToSupabase(config) {
  if (!hasSupabaseUrl() || !hasSupabaseAnonKey()) return null;

  const auth = await loadAuth();
  if (!auth?.token) return null;

  const userId = auth.user?.id || decodeJwtSub(auth.token);
  if (!userId) return null;

  const cacheKey = `${userId}::${config.profileName}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  try {
    const supabase = getUserSupabase(auth.token);
    const { data, error } = await supabase
      .from('profiles')
      .upsert({
        user_id: userId,
        profile_name: config.profileName,
        display_name: config.displayName || config.profileName,
        email: config.applicantEmail || null,
        role_summary: config.userProfile || null,
        min_score: config.geminiMinLocalScore ?? 70,
        auto_apply: !!config.autoApply,
        enabled_sites: config.enabledSites || []
      }, { onConflict: 'user_id,profile_name' })
      .select('id')
      .single();

    if (error) {
      console.warn('[profileSync] upsert error:', error.message);
      return null;
    }

    cache.set(cacheKey, data.id);
    return data.id;
  } catch (err) {
    console.warn('[profileSync] skipped:', err.message);
    return null;
  }
}

function hasSupabaseUrl() {
  return Boolean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
}

function hasSupabaseAnonKey() {
  return Boolean(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function getCachedProfileId(userId, profileName) {
  return cache.get(`${userId}::${profileName}`) || null;
}
