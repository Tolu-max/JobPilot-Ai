import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import { Database, Send, ShieldCheck, Terminal } from 'lucide-react';
import CommandBlock from '@/components/CommandBlock';

export const metadata = { title: 'Setup | JobPilot' };

const steps = [
  {
    num: '01',
    icon: Terminal,
    title: 'Connect the CLI',
    body: 'Run login locally. The CLI opens your browser to the dashboard, hands back a session via loopback — no token paste.',
    cmd: 'jobpilot login',
  },
  {
    num: '02',
    icon: Send,
    title: 'Link Telegram',
    body: 'Create a bot with BotFather, then let the CLI discover your chat and store the token locally. Dashboard never sees it.',
    cmd: 'jobpilot telegram --profile=<profile>',
  },
  {
    num: '03',
    icon: Database,
    title: 'Sync review decisions',
    body: 'Approve or reject roles in the Queue tab. The local scheduler pulls decisions on its next tick and queues approved roles for apply.',
    cmd: 'jobpilot scheduler --profile=<profile>',
  },
  {
    num: '04',
    icon: ShieldCheck,
    title: 'Keep secrets local',
    body: 'AI keys, CAPTCHA keys, resumes, browser profiles, and job-board passwords belong on the local runner — not in this dashboard.',
    cmd: 'jobpilot doctor --profile=<profile>',
  },
];

export default async function SetupPage() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  return (
    <>
      <div style={{ marginBottom: 28 }}>
        <span className="page-eyebrow" style={{ marginBottom: 8 }}>setup</span>
        <h1 className="heading-md" style={{ marginBottom: 6 }}>Connect dashboard + local runner</h1>
        <p style={{ color: 'var(--paper-muted)', fontSize: '0.92rem' }}>
          The dashboard handles review, approvals, and analytics. The CLI handles private files, provider keys, browser automation.
        </p>
      </div>

      <div style={{ display: 'grid', gap: 1, border: '1px solid var(--line)', borderRadius: 4, overflow: 'hidden' }}>
        {steps.map(({ num, icon: Icon, title, body, cmd }) => (
          <div key={num} style={{ display: 'grid', gridTemplateColumns: '52px 1fr', background: 'var(--surface)', borderBottom: '1px solid var(--line)', transition: 'background 0.18s' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-raised)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface)'; }}
          >
            {/* step number gutter */}
            <div style={{ borderRight: '1px solid var(--line)', display: 'grid', placeItems: 'center', padding: '24px 0' }}>
              <span style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: '0.78rem', fontWeight: 600, color: 'var(--violet-light)' }}>{num}</span>
            </div>

            {/* content */}
            <div style={{ padding: '22px 24px', display: 'grid', gridTemplateColumns: '1fr auto', gap: '16px 28px', alignItems: 'center' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <div style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', borderRadius: 3, background: 'rgba(124,77,255,0.1)', color: 'var(--violet-light)' }}>
                    <Icon size={15} />
                  </div>
                  <h2 style={{ fontFamily: 'IBM Plex Mono,monospace', fontWeight: 600, fontSize: '1rem', letterSpacing: '-0.01em' }}>{title}</h2>
                </div>
                <p style={{ color: 'var(--paper-muted)', fontSize: '0.9rem', lineHeight: 1.6 }}>{body}</p>
              </div>
              <div style={{ minWidth: 340 }}>
                <CommandBlock command={cmd} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
