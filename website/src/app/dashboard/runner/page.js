import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import { Activity, Bot, Clock, Play, ShieldCheck, Terminal, Wifi } from 'lucide-react';
import { resolveProfileFilter } from '@/utils/profileFilter';
import CommandBlock from '@/components/CommandBlock';

export const metadata = { title: 'Runner | JobPilot' };

const IconBox = ({ icon: Icon, color = 'var(--violet-light)' }) => (
  <div style={{ width: 36, height: 36, display: 'grid', placeItems: 'center', borderRadius: 4, background: 'rgba(124,77,255,0.1)', color, flexShrink: 0 }}>
    <Icon size={17} />
  </div>
);

function profileSuffix(name) {
  return name ? ` --profile=${name}` : ' --profile=<profile>';
}

export default async function RunnerPage({ searchParams }) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const filter = await resolveProfileFilter({ supabase, userId: user.id, searchParams });

  if (filter.notFound) return (
    <div className="page-header">
      <span className="page-eyebrow">runner</span>
      <h1 className="heading-md">Local runner</h1>
      <p className="text-body">No profile named &quot;{filter.profileName}&quot; found.</p>
    </div>
  );

  let q = supabase.from('job_applications').select('status, updated_at, created_at').eq('user_id', user.id).order('updated_at', { ascending: false });
  if (filter.profileId) q = q.eq('profile_id', filter.profileId);

  const { data: jobs } = await q;
  const latest  = jobs?.[0]?.updated_at || jobs?.[0]?.created_at;
  const approved = jobs?.filter((j) => j.status === 'approved' || j.status === 'pending_apply').length || 0;
  const review   = jobs?.filter((j) => j.status === 'reviewed').length || 0;
  const failed   = jobs?.filter((j) => j.status === 'failed').length || 0;
  const p        = filter.profileName;

  const commands = [
    { icon: Terminal, title: 'Foreground run', body: 'Scrape, score, and queue one pass. Watch logs directly.', cmd: `jobpilot run --limit 50 --review-first${profileSuffix(p)}` },
    { icon: Clock,    title: 'Start scheduler', body: 'Continuous runner (default 15m). Pulls dashboard approvals.', cmd: `jobpilot scheduler${profileSuffix(p)}` },
    { icon: Bot,      title: 'Link Telegram', body: 'Create a BotFather bot, store the token locally.', cmd: `jobpilot telegram${profileSuffix(p)}` },
    { icon: Activity, title: 'Health check', body: 'Validate profile, provider keys, browser, source connectivity.', cmd: `jobpilot doctor${profileSuffix(p)}` },
  ];

  return (
    <>
      <div style={{ marginBottom: 26 }}>
        <span className="page-eyebrow" style={{ marginBottom: 8 }}>runner</span>
        <h1 className="heading-md" style={{ marginBottom: 6 }}>Local runner control</h1>
        <p style={{ color: 'var(--paper-muted)', fontSize: '0.92rem' }}>
          Commands to run or diagnose the local worker.{' '}
          {p && <span style={{ color: 'var(--violet-light)', fontFamily: 'IBM Plex Mono,monospace', fontSize: '0.8rem' }}>[{p}]</span>}
        </p>
      </div>

      {/* stats */}
      <div className="grid-4" style={{ marginBottom: 22 }}>
        {[
          { icon: Wifi,       label: 'last sync',      value: latest ? new Date(latest).toLocaleTimeString() : '—',      sub: latest ? new Date(latest).toLocaleDateString() : 'No sync yet', vStyle: { fontSize: '1.2rem', lineHeight: 1.3 } },
          { icon: Play,       label: 'approved queue', value: approved, sub: 'ready for runner', color: approved ? 'var(--green)' : undefined },
          { icon: ShieldCheck,label: 'needs review',   value: review,   sub: 'approve before apply', color: review ? 'var(--amber)' : undefined },
          { icon: Activity,   label: 'failed',         value: failed,   sub: 'audit apply errors', color: failed ? 'var(--red)' : 'var(--green)' },
        ].map(({ icon: Icon, label, value, sub, color, vStyle }) => (
          <section key={label} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 4, padding: '18px 20px', display: 'grid', gap: 8, minHeight: 120, transition: 'border-color 0.18s' }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--line-violet)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--line)'; }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--paper-muted)', fontFamily: 'IBM Plex Mono,monospace', fontSize: '0.7rem', letterSpacing: '0.04em' }}>
              <Icon size={13} />{label}
            </div>
            <div style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: '2rem', fontWeight: 600, letterSpacing: '-0.02em', color: color || 'var(--paper)', ...vStyle }}>{value}</div>
            <p style={{ color: 'var(--paper-muted)', fontSize: '0.82rem' }}>{sub}</p>
          </section>
        ))}
      </div>

      {/* command blocks */}
      <div className="grid-2" style={{ marginBottom: 22 }}>
        {commands.map(({ icon: Icon, title, body, cmd }) => (
          <section key={title} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 4, padding: '20px', display: 'grid', gap: 12, transition: 'border-color 0.18s' }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--line-violet)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--line)'; }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <IconBox icon={Icon} />
              <div>
                <h2 style={{ fontFamily: 'IBM Plex Mono,monospace', fontWeight: 600, fontSize: '0.98rem', marginBottom: 3 }}>{title}</h2>
                <p style={{ color: 'var(--paper-muted)', fontSize: '0.84rem' }}>{body}</p>
              </div>
            </div>
            <CommandBlock command={cmd} />
          </section>
        ))}
      </div>

      <section style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 4, padding: '18px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <ShieldCheck size={15} style={{ color: 'var(--green)' }} />
          <h2 style={{ fontFamily: 'IBM Plex Mono,monospace', fontWeight: 600, fontSize: '0.9rem' }}>Automation boundary</h2>
        </div>
        <p style={{ color: 'var(--paper-muted)', lineHeight: 1.7, fontSize: '0.92rem' }}>
          The dashboard approves work and shows metadata. It does not launch browser sessions, solve CAPTCHAs, or hold credentials. Your local machine or private worker runs everything sensitive.
        </p>
      </section>
    </>
  );
}
