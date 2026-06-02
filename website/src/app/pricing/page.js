import Link from 'next/link';
import { CheckCircle, CircleDollarSign, KeyRound, Server, ShieldCheck } from 'lucide-react';

export const metadata = { title: 'Pricing | JobPilot' };

const costBlocks = [
  {
    icon: CircleDollarSign,
    title: 'JobPilot CLI',
    price: 'Free',
    body: 'The open-source CLI and local automation runner are intended to be free to install, inspect, and self-host.',
    points: ['Scraping pipeline', 'Local profile onboarding', 'Review queue sync', 'Local browser automation'],
  },
  {
    icon: KeyRound,
    title: 'AI and CAPTCHA providers',
    price: 'Bring your keys',
    body: 'Users pay providers directly. The hosted dashboard should not collect or store those keys.',
    points: ['Gemini, OpenRouter, Groq, or local matching', 'Optional CAPTCHA solver keys', 'Per-user provider choice'],
  },
  {
    icon: Server,
    title: 'Hosted dashboard',
    price: 'Optional',
    body: 'Use the dashboard for auth, approvals, analytics, and safe metadata. Run the worker on your own computer or trusted server.',
    points: ['No hosted CV storage by default', 'No browser cookies', 'No job-board credentials'],
  },
];

export default function PricingPage() {
  return (
    <div className="container section">
      <div className="page-header" style={{ maxWidth: '760px' }}>
        <span className="page-eyebrow"><ShieldCheck size={15} /> Pricing</span>
        <h1 className="heading-lg">Open source first, provider costs transparent.</h1>
        <p className="text-body">
          JobPilot should not become expensive just because someone wants automation. The base project is open source; external AI, CAPTCHA, hosting, and worker costs are controlled by each user.
        </p>
      </div>

      <div className="grid-3">
        {costBlocks.map((block) => {
          const Icon = block.icon;
          return (
            <article key={block.title} className="card" style={{ display: 'grid', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start' }}>
                <div style={{ width: 42, height: 42, display: 'grid', placeItems: 'center', borderRadius: 8, background: 'rgba(79, 140, 255, 0.12)', color: 'var(--accent-light)' }}>
                  <Icon size={21} />
                </div>
                <span className="badge badge-blue">{block.price}</span>
              </div>
              <div>
                <h2 className="heading-md" style={{ marginBottom: 8 }}>{block.title}</h2>
                <p className="muted" style={{ lineHeight: 1.65 }}>{block.body}</p>
              </div>
              <div style={{ display: 'grid', gap: '9px' }}>
                {block.points.map((point) => (
                  <div key={point} style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                    <CheckCircle size={17} style={{ color: 'var(--green)' }} />
                    <span className="muted">{point}</span>
                  </div>
                ))}
              </div>
            </article>
          );
        })}
      </div>

      <section className="panel" style={{ marginTop: '34px', display: 'grid', gridTemplateColumns: '1fr auto', gap: '18px', alignItems: 'center' }}>
        <div>
          <h2 className="heading-md" style={{ marginBottom: 8 }}>Recommended first-run setup</h2>
          <p className="muted" style={{ lineHeight: 1.65 }}>
            Start with local matching, dry-run mode, and review-first queues. Add an AI provider or CAPTCHA solver only after the profile filters and source list are behaving correctly.
          </p>
        </div>
        <Link href="/docs" className="button button-primary">Setup Guide</Link>
      </section>
    </div>
  );
}
