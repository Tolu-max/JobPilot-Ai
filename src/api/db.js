/**
 * Supabase client — single shared instance for the whole API.
 * Uses the service-role key server-side so we can query any table
 * and bypass RLS where needed (admin operations).
 */
import { createClient } from '@supabase/supabase-js';

let _supabase = null;

export function getSupabase() {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY; // server-side: full access
    if (!url || !key) throw new Error('SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
    _supabase = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
  }
  return _supabase;
}

/**
 * Returns a Supabase client scoped to the current user's JWT.
 * Use for RLS-protected queries on behalf of a user.
 */
export function getUserSupabase(accessToken) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false }
  });
}
