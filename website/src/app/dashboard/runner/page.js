import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import { Activity, Bot, Clock, Play, ShieldCheck, Terminal, Wifi } from 'lucide-react';
import { resolveProfileFilter } from '@/utils/profileFilter';
import CommandBlock from '@/components/CommandBlock';

export const metadata = { title: 'Runner | JobPilot' };

function commandFor(profileName, command) {
  const suffix = profileName ? ` --profile=${profileName}` : ' --profile=<profile>';
  return `${command}${suffix}`;
}

function formatDate(value) {
  if (!value) return 'No sync yet';
  return new Date(value).toLocaleString();
}

export default async function RunnerPage({ searchParams }) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const filter = await resolveProfileFilter({ supabase, userId: user.id, searchParams });

  if (filter.notFound) {
    return (
      <div className="page-header">
        <span className="page-eyebrow"><Terminal size={15} /> Runner</span>
        <h1 className="heading-md">Local runner</h1>
        <p className="text-body">No profile named &quot;{filter.profileName}&quot; found.</p>
      </div>
    );
  }

  let query = supabase
    .from('job_applications')
    .select('status, updated_at, created_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (filter.profileId) query = query.eq('profile_id', filter.profileId);

  const { data: jobs } = await query;
  const latestSync = jobs?.[0]?.updated_at || jobs?.[0]?.created_at;
  const approved = jobs?.filter((job) => job.status === 'approved' || job.status === 'pending_apply').length || 0;
  const review = jobs?.filter((job) => job.status === 'reviewed').length || 0;
  const failed = jobs?.filter((job) => job.status === 'failed').length || 0;

  const commands = [
    {
      icon: Terminal,
      title: 'Run one foreground pass',
      body: 'Best for testing new scrapers and seeing logs directly.',
      command: commandFor(filter.profileName, 'jobpilot run --limit 50 --review-first'),
    },
    {
      icon: Clock,
      title: 'Start scheduler',
      body: 'Long-running local or self-hosted worker that pulls dashboard approvals.',
      command: commandFor(filter.profileName, 'jobpilot scheduler'),
    },
    {
      icon: Bot,
      title: 'Link Telegram',
      body: 'Create a bot with BotFather and store its token locally.',
      command: commandFor(filter.profileName, 'jobpilot telegram'),
    },
    {
      icon: Activity,
      title: 'Health check',
      body: 'Validate profile config, provider keys, local files, and browser requirements.',
      command: commandFor(filter.profileName, 'jobpilot doctor'),
    },
  ];

  return (
    <>
      <div className="page-header">
        <span className="page-eyebrow"><Terminal size={15} /> Runner</span>
        <h1 className="heading-md">Local runner control</h1>
        <p className="text-body" style={{ fontSize: '0.95rem' }}>
          Use this page as an operator checklist. The dashboard shows status and commands; the automation still runs from a trusted local worker.
          {filter.profileName && <span style={{ marginLeft: 8, color: 'var(--accent-light)' }}>Profile: {filter.profileName}</span>}
        </p>
      </div>

      <div className="grid-4" style={{ marginBottom: '24px' }}>
        <section className="stat-card panel">
          <div className="stat-label"><Wifi size={16} /> Latest Sync</div>
          <div className="stat-value" style={{ fontSize: '1.25rem', lineHeight: 1.25 }}>{formatDate(latestSync)}</div>
          <p className="muted">Based on dashboard metadata.</p>
        </section>
        <section className="stat-card panel">
          <div className="stat-label"><Play size={16} /> Approved Queue</div>
          <div className="stat-value" style={{ color: approved ? 'var(--green)' : 'var(--text-main)' }}>{approved}</div>
          <p className="muted">Ready for local runner pickup.</p>
        </section>
        <section className="stat-card panel">
          <div className="stat-label"><ShieldCheck size={16} /> Needs Review</div>
          <div className="stat-value" style={{ color: review ? 'var(--amber)' : 'var(--text-main)' }}>{review}</div>
          <p className="muted">Approve or reject before live apply.</p>
        </section>
        <section className="stat-card panel">
          <div className="stat-label"><Activity size={16} /> Failed Attempts</div>
          <div className="stat-value" style={{ color: failed ? 'var(--red)' : 'var(--green)' }}>{failed}</div>
          <p className="muted">Audit form errors and CAPTCHA cases.</p>
        </section>
      </div>

      <div className="grid-2">
        {commands.map((item) => {
          const Icon = item.icon;
          return (
            <section key={item.title} className="panel" style={{ display: 'grid', gap: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: 38, height: 38, display: 'grid', placeItems: 'center', borderRadius: 8, background: 'rgba(79, 140, 255, 0.12)', color: 'var(--accent-light)' }}>
                  <Icon size={19} />
                </div>
                <div>
                  <h2 className="heading-sm">{item.title}</h2>
                  <p className="muted" style={{ fontSize: '0.92rem' }}>{item.body}</p>
                </div>
              </div>
              <CommandBlock command={item.command} />
            </section>
          );
        })}
      </div>

      <section className="panel" style={{ marginTop: '24px' }}>
        <h2 className="heading-sm" style={{ marginBottom: 10 }}>Automation boundary</h2>
        <p className="muted" style={{ lineHeight: 1.7 }}>
          The hosted app should not launch browser sessions, solve CAPTCHAs, or store credentials. It should approve work, show metadata, and let the local runner perform sensitive automation with user-owned configuration.
        </p>
      </section>
    </>
  );
}
