import Link from 'next/link';
import CommandBlock from '@/components/CommandBlock';

export const metadata = { title: 'Pricing · JobPilot' };

const tiers = [
  {
    name: 'CLI + Local',
    badge: 'always free',
    price: '$0',
    sub: 'forever, no account required',
    summary: 'The actual product. Install on your laptop, run as much as you want.',
    points: [
      'All 15+ scrapers',
      'All ATS adapters (Greenhouse, Lever, Ashby, Workable, BambooHR…)',
      'Local matcher (no AI key needed)',
      'Telegram review bot',
      'Multi-profile',
      'Application history (local SQLite)',
    ],
    cta: { href: '/docs#install', label: 'Install →', primary: true },
  },
  {
    name: 'Web Dashboard',
    badge: 'free during beta',
    price: '$0',
    sub: 'limited free tier afterwards',
    summary: 'Optional cloud sync for reviewing on your phone and seeing trends.',
    points: [
      'GitHub or Google sign-in',
      'CLI device-code linking (no token paste)',
      'Review queue, history, source health, runner controls',
      'Multi-profile filtering',
      'Approve / reject from any device',
      'Only metadata syncs — never your resume or keys',
    ],
    cta: { href: '/login', label: 'Open dashboard', primary: false },
  },
  {
    name: 'Managed Worker',
    badge: 'design phase',
    price: 'TBD',
    sub: 'planned: pay for compute, not seats',
    summary: 'For people who don’t want to babysit a Railway box. Same code, same boundary — your secrets encrypted with a key only you hold.',
    points: [
      'Hosted scheduler with persistent volume',
      'Per-user encryption (zero-knowledge)',
      'Pause / resume / migrate at any time',
      'Self-host migration script (one command out)',
      'Public alpha: later this year',
    ],
    cta: { href: '/about', label: 'Read the plan', primary: false },
  },
];

const provider = [
  ['DeepSeek', '$0.10 – $1 / month for a normal search', 'recommended default — cheap and sharp'],
  ['Gemini', 'free tier covers most users', 'fast, good free quota, occasional rate limits'],
  ['OpenRouter', 'pay-as-you-go', 'use any model — Claude, GPT, Mistral, Llama'],
  ['Groq', 'free tier generous', 'fastest tokens around, smaller free models'],
  ['Local matcher only', '$0', 'no AI calls — works fine for keyword-driven roles'],
];

export default function PricingPage() {
  return (
    <div className="container section">
      <div className="page-header" style={{ maxWidth: 780 }}>
        <span className="page-eyebrow">pricing</span>
        <h1 className="heading-lg">The tool is free. The costs you pay are the ones you control.</h1>
        <p className="text-body">
          JobPilot is open source under MIT. The CLI doesn&apos;t talk to a paid backend. If you use AI scoring or CAPTCHA solving, you pay those providers directly — and we don&apos;t see the bill.
        </p>
      </div>

      <div className="grid-3" style={{ marginBottom: 56 }}>
        {tiers.map((tier) => (
          <article key={tier.name} className="panel" style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <span className={`badge ${tier.badge.includes('free') ? 'badge-green' : tier.badge.includes('beta') ? 'badge-blue' : 'badge-amber'}`}>
                {tier.badge}
              </span>
            </div>
            <div>
              <h2 className="heading-md" style={{ marginBottom: 4 }}>{tier.name}</h2>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span className="heading-lg amber-text" style={{ fontSize: '1.85rem' }}>{tier.price}</span>
                <span className="dim" style={{ fontSize: '0.85rem' }}>{tier.sub}</span>
              </div>
            </div>
            <p className="muted" style={{ lineHeight: 1.6 }}>{tier.summary}</p>
            <hr className="rule" />
            <ul style={{ display: 'grid', gap: 8, listStyle: 'none' }}>
              {tier.points.map((p) => (
                <li key={p} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', color: 'var(--paper-soft)', fontSize: '0.93rem', lineHeight: 1.55 }}>
                  <span style={{ color: 'var(--amber)', fontWeight: 700 }}>·</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
            <Link href={tier.cta.href} className={`button ${tier.cta.primary ? 'button-primary' : ''}`} style={{ marginTop: 6, justifySelf: 'flex-start' }}>
              {tier.cta.label}
            </Link>
          </article>
        ))}
      </div>

      <section style={{ marginBottom: 48 }}>
        <div className="kicker" style={{ marginBottom: 14 }}>bring-your-own keys</div>
        <h2 className="heading-md" style={{ marginBottom: 12, maxWidth: 700 }}>
          AI providers: pick one. They&apos;re all wired up. Your keys never leave the laptop.
        </h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>provider</th>
                <th>cost</th>
                <th>notes</th>
              </tr>
            </thead>
            <tbody>
              {provider.map(([name, cost, note]) => (
                <tr key={name}>
                  <td style={{ color: 'var(--paper)', fontWeight: 600, fontFamily: 'IBM Plex Mono, monospace' }}>{name}</td>
                  <td>{cost}</td>
                  <td className="muted">{note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="cta-strip">
        <div>
          <div className="kicker" style={{ marginBottom: 10 }}>recommended starting recipe</div>
          <h2 className="heading-md" style={{ marginBottom: 8 }}>Local matcher + Telegram. Add a $5 DeepSeek key only if you want sharper scoring.</h2>
          <p className="muted" style={{ maxWidth: 540 }}>
            Most people never need more than this. The dashboard is icing — useful, free during beta, but the CLI alone is enough to run a real job search.
          </p>
        </div>
        <div style={{ display: 'grid', gap: 8, minWidth: 280 }}>
          <CommandBlock command="npm i -g jobpilot-cli" />
          <CommandBlock command="jobpilot init --profile=me" />
        </div>
      </div>
    </div>
  );
}
