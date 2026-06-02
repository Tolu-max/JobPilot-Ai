import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import { Briefcase, CheckCircle, Clock, Globe, ListChecks, Zap } from 'lucide-react';
import { resolveProfileFilter } from '@/utils/profileFilter';
import CommandBlock from '@/components/CommandBlock';
import AnalyticsCharts from './AnalyticsCharts';

export const metadata = { title: 'Overview | JobPilot' };

function formatStatus(status) {
  return String(status || 'pending').replace(/_/g, ' ');
}

function statusBadge(status) {
  if (status === 'applied') return 'badge badge-green';
  if (status === 'failed' || status === 'rejected') return 'badge badge-red';
  if (status === 'reviewed') return 'badge badge-amber';
  if (status === 'approved' || status === 'pending_apply') return 'badge badge-blue';
  return 'badge';
}

export default async function DashboardOverview({ searchParams }) {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    redirect('/login');
  }

  const filter = await resolveProfileFilter({ supabase, userId: user.id, searchParams });

  let query = supabase
    .from('job_applications')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (filter.profileId) query = query.eq('profile_id', filter.profileId);
  if (filter.notFound) query = query.eq('profile_id', '00000000-0000-0000-0000-000000000000');

  const { data: jobs } = await query;
  const safeJobs = jobs || [];

  const appliedCount = safeJobs.filter((job) => job.status === 'applied').length;
  const reviewCount = safeJobs.filter((job) => job.status === 'reviewed').length;
  const queuedCount = safeJobs.filter((job) => job.status === 'pending_apply' || job.status === 'approved').length;
  const failedCount = safeJobs.filter((job) => job.status === 'failed').length;
  const sources = new Set(safeJobs.map((job) => job.source_site).filter(Boolean)).size;
  const latestSync = safeJobs[0]?.updated_at || safeJobs[0]?.created_at;
  const appliedRate = safeJobs.length ? Math.round((appliedCount / safeJobs.length) * 100) : 0;
  const recentJobs = safeJobs.slice(0, 6);

  return (
    <>
      <div className="page-header">
        <span className="page-eyebrow"><Briefcase size={15} /> Overview</span>
        <h1 className="heading-md">Pipeline overview</h1>
        <p className="text-body" style={{ fontSize: '0.95rem' }}>
          Signed in as {user.user_metadata?.full_name || user.email}. Review source health, queued roles, and recent activity.
          {filter.profileName && (
            <span style={{ marginLeft: '8px', color: 'var(--accent-light)' }}>Profile: {filter.profileName}</span>
          )}
        </p>
      </div>

      <div className="grid-4" style={{ marginBottom: '24px' }}>
        <section className="stat-card panel">
          <div className="stat-label"><Briefcase size={16} /> Total Jobs</div>
          <div className="stat-value">{safeJobs.length}</div>
          <p className="muted">{sources} source{sources === 1 ? '' : 's'} synced</p>
        </section>
        <section className="stat-card panel">
          <div className="stat-label"><CheckCircle size={16} /> Applied</div>
          <div className="stat-value" style={{ color: 'var(--green)' }}>{appliedCount}</div>
          <p className="muted">{appliedRate}% of synced jobs</p>
        </section>
        <section className="stat-card panel">
          <div className="stat-label"><Clock size={16} /> Needs Review</div>
          <div className="stat-value" style={{ color: reviewCount ? 'var(--amber)' : 'var(--text-main)' }}>{reviewCount}</div>
          <p className="muted">Approve or reject before apply</p>
        </section>
        <section className="stat-card panel">
          <div className="stat-label"><Zap size={16} /> Approved Queue</div>
          <div className="stat-value" style={{ color: queuedCount ? 'var(--accent-light)' : 'var(--text-main)' }}>{queuedCount}</div>
          <p className="muted">{failedCount} failed attempt{failedCount === 1 ? '' : 's'}</p>
        </section>
      </div>

      <div className="grid-2" style={{ marginBottom: '24px' }}>
        <section className="panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: 10 }}>
            <Globe size={18} style={{ color: 'var(--accent-light)' }} />
            <h2 className="heading-sm">Latest sync</h2>
          </div>
          <p className="text-body" style={{ fontSize: '1rem' }}>
            {latestSync ? new Date(latestSync).toLocaleString() : 'No synced jobs yet.'}
          </p>
        </section>
        <section className="panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: 10 }}>
            <ListChecks size={18} style={{ color: 'var(--green)' }} />
            <h2 className="heading-sm">Next action</h2>
          </div>
          <p className="text-body" style={{ fontSize: '1rem' }}>
            {reviewCount > 0
              ? 'Review pending jobs so the local runner can pick up approved roles.'
              : queuedCount > 0
                ? 'Start the local runner to process approved jobs.'
                : 'Run the CLI scraper to bring in fresh roles.'}
          </p>
        </section>
      </div>

      {safeJobs.length > 0 ? (
        <>
          <AnalyticsCharts jobs={safeJobs} />

          <section className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
              <div>
                <h2 className="heading-sm">Recent activity</h2>
                <p className="muted">Latest synced jobs across the active profile filter.</p>
              </div>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Company</th>
                    <th>Source</th>
                    <th>Score</th>
                    <th>Status</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {recentJobs.map((job) => (
                    <tr key={job.id}>
                      <td style={{ color: 'var(--text-main)', fontWeight: 700 }}>{job.title || 'Untitled role'}</td>
                      <td>{job.company || 'Unknown'}</td>
                      <td>{job.source_site || 'Unknown'}</td>
                      <td>{job.score ?? 0}</td>
                      <td><span className={statusBadge(job.status)}>{formatStatus(job.status)}</span></td>
                      <td>{new Date(job.updated_at || job.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <section className="panel" style={{ textAlign: 'center' }}>
          <h2 className="heading-sm" style={{ marginBottom: 8 }}>No jobs synced yet</h2>
          <p className="muted" style={{ marginBottom: 14 }}>Run one review-first pass from your local terminal to start filling the dashboard.</p>
          <CommandBlock command="jobpilot run --profile=<profile> --limit 50 --review-first" style={{ maxWidth: 560, margin: '0 auto' }} />
        </section>
      )}
    </>
  );
}
