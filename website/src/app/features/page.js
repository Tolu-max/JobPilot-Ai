import Link from 'next/link';
import {
  Bell,
  Bot,
  Brain,
  CheckCircle,
  ClipboardCheck,
  DatabaseZap,
  Gauge,
  Globe,
  LockKeyhole,
  MonitorCheck,
  Route,
  ShieldCheck,
} from 'lucide-react';

export const metadata = { title: 'Features | JobPilot' };

const featureGroups = [
  {
    title: 'Find better roles',
    items: [
      {
        icon: Globe,
        title: 'Multi-source scraping',
        body: 'Collect roles from implemented remote job sources and normalize them into one review pipeline.',
      },
      {
        icon: Gauge,
        title: 'Freshness and fit checks',
        body: 'Prefer recent remote listings, remove duplicates, and filter against country, title, and profile preferences.',
      },
      {
        icon: Brain,
        title: 'Optional AI scoring',
        body: 'Use local matching first, then let Gemini, OpenRouter, Groq, or another configured provider improve fit scoring.',
      },
    ],
  },
  {
    title: 'Apply with control',
    items: [
      {
        icon: ClipboardCheck,
        title: 'Review-first queue',
        body: 'Approve or reject jobs in the hosted dashboard or Telegram before the local runner attempts an application.',
      },
      {
        icon: Route,
        title: 'ATS-aware routing',
        body: 'Recognize audited application flows and send unknown ATS platforms to manual review until they are tested.',
      },
      {
        icon: MonitorCheck,
        title: 'Local browser automation',
        body: 'Use Playwright from your own machine or worker, preserving browser sessions and private files locally.',
      },
    ],
  },
  {
    title: 'Operate safely',
    items: [
      {
        icon: LockKeyhole,
        title: 'Secrets stay local',
        body: 'Keep AI keys, CAPTCHA keys, resumes, recordings, cookies, and job-board passwords out of the hosted app.',
      },
      {
        icon: Bell,
        title: 'Telegram approvals',
        body: 'Create your own bot, link it from the CLI, and receive queue updates without sharing the bot token with JobPilot web.',
      },
      {
        icon: DatabaseZap,
        title: 'Safe dashboard sync',
        body: 'Sync metadata such as job title, status, score, source, and timestamps for review and analytics.',
      },
    ],
  },
];

const checks = [
  'Dry-run mode for testing new sources',
  'Profile-specific thresholds and source limits',
  'Manual review for unknown application systems',
  'Dashboard approvals pulled by the local scheduler',
];

export default function FeaturesPage() {
  return (
    <div className="container section">
      <div className="page-header" style={{ maxWidth: '780px' }}>
        <span className="page-eyebrow"><ShieldCheck size={15} /> Feature Set</span>
        <h1 className="heading-lg">Automation that keeps the risky parts close to the user.</h1>
        <p className="text-body">
          JobPilot combines a terminal-first workflow, optional dashboard review, and local browser automation so open-source users can automate without handing over their private keys.
        </p>
      </div>

      <div style={{ display: 'grid', gap: '34px' }}>
        {featureGroups.map((group) => (
          <section key={group.title}>
            <h2 className="heading-md" style={{ marginBottom: '16px' }}>{group.title}</h2>
            <div className="grid-3">
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <article key={item.title} className="card">
                    <div style={{ width: 40, height: 40, display: 'grid', placeItems: 'center', borderRadius: 8, background: 'rgba(79, 140, 255, 0.12)', color: 'var(--accent-light)', marginBottom: 14 }}>
                      <Icon size={20} />
                    </div>
                    <h3 className="heading-sm" style={{ marginBottom: 8 }}>{item.title}</h3>
                    <p className="muted" style={{ lineHeight: 1.65 }}>{item.body}</p>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <section className="panel" style={{ marginTop: '42px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', alignItems: 'center' }}>
        <div>
          <span className="page-eyebrow"><Bot size={15} /> Operator workflow</span>
          <h2 className="heading-md" style={{ margin: '14px 0 10px' }}>Built for terminal onboarding first.</h2>
          <p className="text-body">
            The web dashboard is useful, but the CLI remains the source of truth for private configuration, profiles, and automation runs.
          </p>
        </div>
        <div style={{ display: 'grid', gap: '10px' }}>
          {checks.map((check) => (
            <div key={check} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <CheckCircle size={18} style={{ color: 'var(--green)' }} />
              <span className="muted">{check}</span>
            </div>
          ))}
          <div style={{ display: 'flex', gap: '10px', marginTop: '10px', flexWrap: 'wrap' }}>
            <Link href="/docs" className="button button-primary">Read Docs</Link>
            <Link href="/login" className="button">Open Dashboard</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
