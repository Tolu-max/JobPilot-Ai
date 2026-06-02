import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import { Database, Send, ShieldCheck, Terminal } from 'lucide-react';
import CommandBlock from '@/components/CommandBlock';

export const metadata = { title: 'Setup | JobPilot' };

const steps = [
  {
    icon: Terminal,
    title: 'Connect the CLI',
    body: 'Run auth locally so the CLI can sync safe metadata to this dashboard.',
    command: 'jobpilot login',
  },
  {
    icon: Send,
    title: 'Link Telegram',
    body: 'Create your own bot with BotFather, then let the CLI discover your chat and save the token locally.',
    command: 'jobpilot telegram --profile=<profile>',
  },
  {
    icon: Database,
    title: 'Sync Review Decisions',
    body: 'Approve or reject jobs here. The local scheduler pulls those decisions on its next run.',
    command: 'jobpilot scheduler --profile=<profile>',
  },
  {
    icon: ShieldCheck,
    title: 'Keep Secrets Local',
    body: 'Do not put AI keys, CAPTCHA keys, resumes, browser profiles, or job-board passwords in the hosted dashboard.',
    command: 'jobpilot doctor --profile=<profile>',
  },
];

export default async function SetupPage() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  return (
    <>
      <div className="page-header">
        <span className="page-eyebrow"><ShieldCheck size={15} /> Setup</span>
        <h1 className="heading-md">Connect dashboard and local runner</h1>
        <p className="text-body" style={{ fontSize: '0.95rem' }}>
          The dashboard handles review and visibility. The CLI handles private files, provider keys, CAPTCHA solving, and browser automation.
        </p>
      </div>

      <div className="grid-4">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <section key={step.title} className="panel" style={{ display: 'grid', gap: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: 38, height: 38, display: 'grid', placeItems: 'center', borderRadius: 8, background: 'rgba(79, 140, 255, 0.12)', color: 'var(--accent-light)' }}>
                  <Icon size={19} />
                </div>
                <h2 className="heading-sm">{step.title}</h2>
              </div>
              <p className="muted" style={{ lineHeight: 1.65 }}>{step.body}</p>
              <CommandBlock command={step.command} />
            </section>
          );
        })}
      </div>
    </>
  );
}
