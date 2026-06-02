"use server"

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'

export async function updateJobStatus(jobId, newStatus) {
  try {
    const supabase = await createClient()
    
    // Verify auth
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      throw new Error('Unauthorized')
    }

    const { error } = await supabase
      .from('job_applications')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', jobId)
      .eq('user_id', user.id)

    if (error) throw error

    revalidatePath('/dashboard')
    revalidatePath('/dashboard/queue')
    revalidatePath('/dashboard/history')
    
    return { success: true }
  } catch (err) {
    console.error('Failed to update job status:', err)
    return { success: false, error: err.message }
  }
}

export async function updateProfileSettings(profileId, payload) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      throw new Error('Unauthorized')
    }

    const minScore = Number.parseInt(payload.min_score, 10)
    const safeMinScore = Number.isFinite(minScore)
      ? Math.min(100, Math.max(0, minScore))
      : 70

    const { error } = await supabase
      .from('profiles')
      .update({
        display_name: String(payload.display_name || '').slice(0, 120),
        role_summary: String(payload.role_summary || '').slice(0, 500),
        min_score: safeMinScore,
        auto_apply: Boolean(payload.auto_apply),
        updated_at: new Date().toISOString()
      })
      .eq('id', profileId)
      .eq('user_id', user.id)

    if (error) throw error

    revalidatePath('/dashboard')
    revalidatePath('/dashboard/settings')

    return { success: true }
  } catch (err) {
    console.error('Failed to update profile settings:', err)
    return { success: false, error: err.message }
  }
}
