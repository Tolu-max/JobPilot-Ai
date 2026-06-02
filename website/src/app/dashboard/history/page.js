import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import { History } from 'lucide-react';
import { resolveProfileFilter } from '@/utils/profileFilter';
import DashboardTable from '../DashboardTable';

export const metadata = { title: 'History | JobPilot' };

export default async function HistoryPage({ searchParams }) {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const filter = await resolveProfileFilter({ supabase, userId: user.id, searchParams });

  if (filter.notFound) {
    return (
      <div className="page-header">
        <span className="page-eyebrow"><History size={15} /> History</span>
        <h1 className="heading-md">Application History</h1>
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
    .in('status', ['applied', 'failed', 'rejected', 'skipped'])
    .order('updated_at', { ascending: false });

  if (filter.profileId) query = query.eq('profile_id', filter.profileId);

  const { data: jobs } = await query;

  return (
    <>
      <div className="page-header">
        <span className="page-eyebrow"><History size={15} /> History</span>
        <h1 className="heading-md">Application History</h1>
        <p className="text-body" style={{ fontSize: '0.95rem' }}>
          Completed applications, failed attempts, rejected roles, and skipped roles.
          {filter.profileName && (
            <span style={{ marginLeft: '8px', color: 'var(--accent-light)' }}>Profile: {filter.profileName}</span>
          )}
        </p>
      </div>

      <DashboardTable initialJobs={jobs || []} mode="history" />
    </>
  );
}
