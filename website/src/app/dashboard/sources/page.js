import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import { BarChart3, CheckCircle, ExternalLink, Globe, TriangleAlert } from 'lucide-react';
import { resolveProfileFilter } from '@/utils/profileFilter';

export const metadata = { title: 'Sources | JobPilot' };

const SOURCE_NOTES = {
  remoteok: 'Gateway source. Company apply pages may redirect to ATS flows.',
  remotive: 'Good remote feed for engineering and support roles.',
  himalayas: 'Useful startup remote roles; apply flow varies by company.',
  jobberman: 'Nigeria-focused listings. Keep remote and country filters strict.',
  influx: 'Company careers source. Best for support profiles.',
  remotejobs: 'Aggregator source. Requires ATS/gateway review before submit.',
};

function canonicalSource(value) {
  const raw = String(value || 'unknown').trim();
  if (!raw) return 'unknown';
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function formatSource(value) {
  if (!value) return 'Unknown';
  return String(value)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildSourceStats(jobs = []) {
  const bySource = new Map();

  jobs.forEach((job) => {
    const key = canonicalSource(job.source_site);
    const existing = bySource.get(key) || {
      key,
      label: formatSource(job.source_site || key),
      total: 0,
      applied: 0,
      failed: 0,
      queued: 0,
      review: 0,
      rejected: 0,
      scoreTotal: 0,
      scoreCount: 0,
      lastSeen: null,
    };

    existing.total += 1;
    if (job.status === 'applied') existing.applied += 1;
    if (job.status === 'failed') existing.failed += 1;
    if (job.status === 'approved' || job.status === 'pending_apply') existing.queued += 1;
    if (job.status === 'reviewed') existing.review += 1;
    if (job.status === 'rejected') existing.rejected += 1;
    if (Number.isFinite(job.score)) {
      existing.scoreTotal += job.score;
      existing.scoreCount += 1;
    }
    if (!existing.lastSeen || new Date(job.updated_at || job.created_at) > new Date(existing.lastSeen)) {
      existing.lastSeen = job.updated_at || job.created_at;
    }

    bySource.set(key, existing);
  });

  return Array.from(bySource.values())
    .map((source) => ({
      ...source,
      avgScore: source.scoreCount ? Math.round(source.scoreTotal / source.scoreCount) : 0,
      note: SOURCE_NOTES[source.key] || 'Track this source until enough jobs are audited.',
    }))
    .sort((a, b) => b.total - a.total);
}

export default async function SourcesPage({ searchParams }) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const filter = await resolveProfileFilter({ supabase, userId: user.id, searchParams });

  if (filter.notFound) {
    return (
      <div className="page-header">
        <span className="page-eyebrow"><Globe size={15} /> Sources</span>
        <h1 className="heading-md">Source performance</h1>
        <p className="text-body">No profile named &quot;{filter.profileName}&quot; found.</p>
      </div>
    );
  }

  let query = supabase
    .from('job_applications')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (filter.profileId) query = query.eq('profile_id', filter.profileId);

  const { data: jobs } = await query;
  const stats = buildSourceStats(jobs || []);
  const bestSource = stats[0];
  const problemSources = stats.filter((source) => source.failed > 0).length;

  return (
    <>
      <div className="page-header">
        <span className="page-eyebrow"><Globe size={15} /> Sources</span>
        <h1 className="heading-md">Source performance</h1>
        <p className="text-body" style={{ fontSize: '0.95rem' }}>
          Compare job boards and company career sources by scraped volume, score, queue status, and failures.
          {filter.profileName && <span style={{ marginLeft: 8, color: 'var(--accent-light)' }}>Profile: {filter.profileName}</span>}
        </p>
      </div>

      <div className="grid-3" style={{ marginBottom: '24px' }}>
        <section className="stat-card panel">
          <div className="stat-label"><Globe size={16} /> Sources Seen</div>
          <div className="stat-value">{stats.length}</div>
          <p className="muted">Unique source labels in synced jobs.</p>
        </section>
        <section className="stat-card panel">
          <div className="stat-label"><CheckCircle size={16} /> Top Source</div>
          <div className="stat-value" style={{ fontSize: '1.7rem' }}>{bestSource?.label || 'None'}</div>
          <p className="muted">{bestSource ? `${bestSource.total} jobs synced` : 'Run the CLI to populate source data.'}</p>
        </section>
        <section className="stat-card panel">
          <div className="stat-label"><TriangleAlert size={16} /> Sources With Failures</div>
          <div className="stat-value" style={{ color: problemSources ? 'var(--amber)' : 'var(--green)' }}>{problemSources}</div>
          <p className="muted">Review failed apply attempts before enabling live submit.</p>
        </section>
      </div>

      {stats.length === 0 ? (
        <section className="panel" style={{ textAlign: 'center' }}>
          <h2 className="heading-sm" style={{ marginBottom: 8 }}>No source data yet</h2>
          <p className="muted">Run <code>jobpilot run --profile=&lt;profile&gt;</code> or the scheduler to sync scraped jobs.</p>
        </section>
      ) : (
        <section className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h2 className="heading-sm">Source table</h2>
              <p className="muted">Use this to decide which scrapers need fixes or more testing.</p>
            </div>
            <span className="badge badge-blue"><BarChart3 size={14} /> {jobs?.length || 0} synced jobs</span>
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Total</th>
                  <th>Avg Score</th>
                  <th>Review</th>
                  <th>Queued</th>
                  <th>Applied</th>
                  <th>Failed</th>
                  <th>Last Seen</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((source) => (
                  <tr key={source.key}>
                    <td style={{ color: 'var(--text-main)', fontWeight: 700 }}>{source.label}</td>
                    <td>{source.total}</td>
                    <td><span className={source.avgScore >= 75 ? 'badge badge-green' : source.avgScore >= 50 ? 'badge badge-amber' : 'badge'}>{source.avgScore}</span></td>
                    <td>{source.review}</td>
                    <td>{source.queued}</td>
                    <td style={{ color: 'var(--green)' }}>{source.applied}</td>
                    <td style={{ color: source.failed ? 'var(--red)' : 'var(--text-muted)' }}>{source.failed}</td>
                    <td>{source.lastSeen ? new Date(source.lastSeen).toLocaleDateString() : 'Never'}</td>
                    <td style={{ maxWidth: 280 }}>{source.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="panel" style={{ marginTop: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h2 className="heading-sm" style={{ marginBottom: 8 }}>Adding another scraper?</h2>
          <p className="muted">Add tests for recency, duplicates, fit filtering, and apply-flow routing before live submit.</p>
        </div>
        <a href="https://github.com/jobpilot-ai/jobpilot" target="_blank" rel="noreferrer" className="button">
          Contribution Guide <ExternalLink size={16} />
        </a>
      </section>
    </>
  );
}
