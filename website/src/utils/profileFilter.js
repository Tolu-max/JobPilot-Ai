/**
 * Resolves the active profile filter from a Next.js page's searchParams.
 *
 * Returns:
 *   { profileName, profileId } — profileId is null if no filter requested
 *                                or if the named profile doesn't exist
 *   { notFound: true } — the user explicitly asked for a profile that
 *                        doesn't exist (so callers can short-circuit)
 *
 * Usage in a server page:
 *   const filter = await resolveProfileFilter({ supabase, userId, searchParams })
 *   if (filter.notFound) return <NotFound name={filter.profileName} />
 *   if (filter.profileId) query = query.eq('profile_id', filter.profileId)
 */
export async function resolveProfileFilter({ supabase, userId, searchParams }) {
  const params = (await searchParams) || {}
  const profileName = typeof params.profile === 'string' ? params.profile : ''
  if (!profileName) return { profileName: '', profileId: null }

  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', userId)
    .eq('profile_name', profileName)
    .single()

  if (!data?.id) return { profileName, profileId: null, notFound: true }
  return { profileName, profileId: data.id }
}
