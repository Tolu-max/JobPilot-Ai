import Link from 'next/link';
import { Code2, GitPullRequest, HeartHandshake, ShieldCheck, Terminal } from 'lucide-react';

export const metadata = { title: 'About | JobPilot' };

const principles = [
  {
    icon: Terminal,
    title: 'Terminal first',
    body: 'Onboarding, local secrets, scheduling, and automation belong in the CLI where the user controls the environment.',
  },
  {
    icon: ShieldCheck,
    title: 'Hosted app second',
    body: 'The web dashboard should handle safe metadata, approvals, analytics, docs, and account identity.',
  },
  {
    icon: GitPullRequest,
    title: 'Contributors welcome',
    body: 'New scrapers, ATS resolvers, tests, and provider adapters should be easy for open-source contributors to add.',
  },
  {
    icon: Code2,
    title: 'Audits before submits',
    body: 'Applying is high-impact. Unknown forms should be reviewed manually until the implementation is tested.',
  },
];

export default function AboutPage() {
  return (
    <div className="container section">
      <div className="page-header" style={{ maxWidth: '820px' }}>
        <span className="page-eyebrow"><HeartHandshake size={15} /> About</span>
        <h1 className="heading-lg">JobPilot is an open-source job automation project with local-first boundaries.</h1>
        <p className="text-body">
          The goal is not to hide a black-box applicant bot behind a hosted dashboard. The goal is to give users and contributors a practical system they can inspect, run, improve, and trust.
        </p>
      </div>

      <section className="panel" style={{ marginBottom: '28px' }}>
        <h2 className="heading-md" style={{ marginBottom: 10 }}>Why the project exists</h2>
        <p className="text-body">
          Applying for remote work often means checking many boards, repeating forms, answering screening questions, and tracking what happened. JobPilot turns that into a pipeline: scrape, score, review, apply, and report.
        </p>
      </section>

      <div className="grid-4">
        {principles.map((item) => {
          const Icon = item.icon;
          return (
            <article key={item.title} className="card">
              <Icon size={22} style={{ color: 'var(--accent-light)', marginBottom: 12 }} />
              <h2 className="heading-sm" style={{ marginBottom: 8 }}>{item.title}</h2>
              <p className="muted" style={{ lineHeight: 1.65 }}>{item.body}</p>
            </article>
          );
        })}
      </div>

      <section className="panel" style={{ marginTop: '34px', display: 'grid', gridTemplateColumns: '1fr auto', gap: '18px', alignItems: 'center' }}>
        <div>
          <h2 className="heading-md" style={{ marginBottom: 8 }}>The next design target</h2>
          <p className="muted" style={{ lineHeight: 1.65 }}>
            Make terminal onboarding easier than the web app, then let the web dashboard focus on visibility and decisions.
          </p>
        </div>
        <Link href="/docs" className="button button-primary">Start with the CLI</Link>
      </section>
    </div>
  );
}
