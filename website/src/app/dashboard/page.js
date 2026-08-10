import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import { Activity, AlertTriangle, CheckCircle2, Clock3, ExternalLink, ListChecks, Play, Radar, ShieldCheck } from 'lucide-react';
import { resolveProfileFilter } from '@/utils/profileFilter';
import CommandBlock from '@/components/CommandBlock';
import AnalyticsCharts from './AnalyticsCharts';

export const metadata = { title: 'Overview | JobPilot' };

function fmt(status) {
  return String(status || 'pending').replace(/_/g, ' ');
}

function statusBadge(status) {
  if (status === 'applied') return 'badge badge-green';
  if (status === 'failed' || status === 'rejected') return 'badge badge-red';
  if (status === 'reviewed') return 'badge badge-amber';
  if (status === 'approved' || status === 'pending_apply') return 'badge badge-blue';
  return 'badge';
}

function StatTile({ icon: Icon, label, value, detail, tone = '' }) {
  return (
    <section className={`dash-tile ${tone}`}>
      <div className="dash-tile-label"><Icon size={15} /> {label}</div>
      <strong>{value}</strong>
      <span>{detail}</span>
    </section>
  );
}

export default async function DashboardOverview({ searchParams }) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const filter = await resolveProfileFilter({ supabase, userId: user.id, searchParams });

  let q = supabase.from('job_applications').select('*').eq('user_id', user.id).order('updated_at', { ascending: false });
  if (filter.profileId) q = q.eq('profile_id', filter.profileId);
  if (filter.notFound) q = q.eq('profile_id', '00000000-0000-0000-0000-000000000000');

  const { data: jobs } = await q;
  const all = jobs || [];
  const applied = all.filter((job) => job.status === 'applied').length;
  const needsReview = all.filter((job) => job.status === 'reviewed').length;
  const queued = all.filter((job) => job.status === 'pending_apply' || job.status === 'approved').length;
  const failed = all.filter((job) => job.status === 'failed').length;
  const ignored = all.filter((job) => job.status === 'ignored').length;
  const sources = new Set(all.map((job) => job.source_site).filter(Boolean)).size;
  const latestSync = all[0]?.updated_at || all[0]?.created_at;
  const rate = all.length ? Math.round((applied / all.length) * 100) : 0;
  const strong = all.filter((job) => Number(job.score || 0) >= 75).length;
  const profileName = filter.profileName || '<profile>';
  const recent = all.slice(0, 7);

  const nextAction = needsReview > 0
    ? { title: `${needsReview} roles need approval`, body: 'Open the queue or approve from Telegram before the runner submits anything.', command: null, tone: 'warn' }
    : queued > 0
      ? { title: `${queued} roles queued to apply`, body: 'Start the scheduler locally so approved roles can move through known apply flows.', command: `jobpilot scheduler --profile=${profileName}`, tone: 'ready' }
      : { title: 'Run a fresh local pass', body: 'Pull new roles, score them, and sync metadata back into this dashboard.', command: `jobpilot run --profile=${profileName} --review-first`, tone: 'idle' };

  return (
    <div className="dash-page">
      <header className="dash-hero">
        <div>
          <div className="page-eyebrow">overview</div>
          <h1>Local runner status</h1>
          <p>
            {user.user_metadata?.full_name || user.email}
            {filter.profileName && <span>[{filter.profileName}]</span>}
          </p>
        </div>
        <div className="dash-hero-meta">
          <span><ShieldCheck size={14} /> metadata only</span>
          <span><Clock3 size={14} /> {latestSync ? new Date(latestSync).toLocaleString() : 'no sync yet'}</span>
        </div>
      </header>

      <section className={`dash-next ${nextAction.tone}`}>
        <div>
          <div className="dash-next-label"><ListChecks size={16} /> next action</div>
          <h2>{nextAction.title}</h2>
          <p>{nextAction.body}</p>
        </div>
        {nextAction.command ? (
          <CommandBlock command={nextAction.command} />
        ) : (
          <a href="/dashboard/queue" className="button button-primary">Review queue</a>
        )}
      </section>

      <div className="dash-grid">
        <StatTile icon={Radar} label="synced roles" value={all.length} detail={`${sources} active sources`} />
        <StatTile icon={ListChecks} label="review" value={needsReview} detail={`${strong} strong matches`} tone={needsReview ? 'warn' : ''} />
        <StatTile icon={Play} label="queued" value={queued} detail="waiting for runner" tone={queued ? 'violet' : ''} />
        <StatTile icon={CheckCircle2} label="applied" value={applied} detail={`${rate}% of synced`} tone={applied ? 'green' : ''} />
        <StatTile icon={AlertTriangle} label="failed" value={failed} detail={`${ignored} ignored`} tone={failed ? 'red' : ''} />
      </div>

      {all.length > 0 ? (
        <>
          <AnalyticsCharts jobs={all} />

          <section className="dash-activity">
            <div className="dash-section-head">
              <div>
                <h2>Recent decisions</h2>
                <p>Newest synced jobs across the selected profile.</p>
              </div>
              <a href="/dashboard/history" className="dash-link">View history <ExternalLink size={13} /></a>
            </div>

            <div className="dash-job-list">
              {recent.map((job) => (
                <article className="dash-job-row" key={job.id}>
                  <div className="dash-job-main">
                    <strong>{job.title || 'Untitled role'}</strong>
                    <span>{job.company || 'Unknown company'} · {job.source_site || 'unknown source'}</span>
                  </div>
                  <div className="dash-job-score">
                    <b>{job.score ?? 0}</b>
                    <small>score</small>
                  </div>
                  <span className={statusBadge(job.status)}>{fmt(job.status)}</span>
                  <time>{new Date(job.updated_at || job.created_at).toLocaleDateString()}</time>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : (
        <section className="dash-empty">
          <Activity size={28} />
          <h2>No jobs synced yet</h2>
          <p>Run one local pass to populate this dashboard with job titles, scores, sources, and statuses.</p>
          <CommandBlock command={`jobpilot run --profile=${profileName} --limit 50 --review-first`} />
        </section>
      )}
    </div>
  );
}
