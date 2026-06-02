import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import { ListChecks } from 'lucide-react';
import { resolveProfileFilter } from '@/utils/profileFilter';
import DashboardTable from '../DashboardTable';

export const metadata = { title: 'Review Queue | JobPilot' };

export default async function QueuePage({ searchParams }) {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const filter = await resolveProfileFilter({ supabase, userId: user.id, searchParams });

  if (filter.notFound) {
    return (
      <div className="page-header">
        <span className="page-eyebrow"><ListChecks size={15} /> Queue</span>
        <h1 className="heading-md">Review Queue</h1>
        <p className="text-body" style={{ fontSize: '0.95rem' }}>
          No profile named &quot;{filter.profileName}&quot; found.
        </p>
      </div>
    );
  }

  let query = supabase
    .from('job_applications')
    .select('*')
    .eq('user_id', user.id)
    .in('status', ['reviewed', 'pending_apply', 'approved'])
    .order('score', { ascending: false });

  if (filter.profileId) query = query.eq('profile_id', filter.profileId);

  const { data: jobs } = await query;

  return (
    <>
      <div className="page-header">
        <span className="page-eyebrow"><ListChecks size={15} /> Queue</span>
        <h1 className="heading-md">Review Queue</h1>
        <p className="text-body" style={{ fontSize: '0.95rem' }}>
          Jobs awaiting review before being queued for local browser automation.
          {filter.profileName && (
            <span style={{ marginLeft: '8px', color: 'var(--accent-light)' }}>Profile: {filter.profileName}</span>
          )}
        </p>
      </div>

      <DashboardTable initialJobs={jobs || []} mode="queue" />
    </>
  );
}
