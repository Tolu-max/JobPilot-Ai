import Link from 'next/link';

export const metadata = { title: 'FAQ · JobPilot' };

const faqs = [
  {
    q: 'Will it auto-apply to jobs without me looking?',
    a: 'Not by default. Review-first is on out of the box: roles get scraped, scored, and queued, but nothing is submitted until you approve from Telegram or the dashboard. You can opt into auto-apply per source for trusted boards once you trust them — that flag is off until you set it.',
  },
  {
    q: 'Does the web app store my resume, AI keys, or job-board passwords?',
    a: 'No. The web only ever sees job metadata: title, company, source, score, status, URL, timestamps, and a profile label. Resumes, AI keys, CAPTCHA solver keys, browser cookies, and job-board logins live exclusively on the laptop running the CLI. The dashboard literally has no API to receive them.',
  },
  {
    q: 'Can I run this on a server, not my laptop?',
    a: 'Yes. The runner is the same Node image whether it lives on your laptop, a Railway service, a Fly machine, or a VPS. As long as you control the host and can mount a persistent volume for state, it works. You stay the only person with the keys — the dashboard does not get a backdoor to your worker.',
  },
  {
    q: 'How does the CLI ↔ web auth handoff work?',
    a: 'You run jobpilot login. The CLI spins up a localhost loopback on a random high port, opens your browser to /login on the dashboard, you sign in with GitHub or Google, the dashboard hands the session token back to your loopback, and the CLI stores it under ~/.jobpilot/. You never paste a token. The token is scoped to dashboard sync only and you can revoke it from the dashboard at any time.',
  },
  {
    q: 'What happens when a company posts on an ATS JobPilot doesn’t know yet?',
    a: 'It goes to the review queue with the apply URL and the scraped metadata. Nothing auto-submits. You can apply by hand, and if it’s a popular enough ATS, open a ticket — adapter PRs are small and reviewed quickly.',
  },
  {
    q: 'Do I need an AI key to use this?',
    a: 'No. The local matcher (keyword + skill weighting) handles most decisions without any AI call at all. AI is a tiebreaker for the close ones — useful, not required. A search using only the local matcher costs nothing and runs offline.',
  },
  {
    q: 'How do I add a new job board?',
    a: 'Drop a file under src/scrapers/, export a scrape() function returning normalized jobs, and add the source to config/sites.json. Around 150 lines plus a fixture test. The contributor docs walk through it with a real example.',
  },
  {
    q: 'What about CAPTCHA?',
    a: 'If a job board throws a CAPTCHA and you have a CapSolver key, JobPilot solves it. No key, no bypass — the job routes to manual review with a screenshot of where it stopped. We don’t ship a default CAPTCHA solver.',
  },
  {
    q: 'How do duplicates get handled?',
    a: 'Hashing on normalized title + company + URL stem, scoped across all profiles on your install. The same role being on Greenhouse, Lever, and RemoteOK only pings you once. Status updates (e.g. applied) propagate across the duplicates so you can’t accidentally double-apply.',
  },
  {
    q: 'Is this affiliated with any AI company?',
    a: 'No. JobPilot is MIT-licensed open source, with no corporate sponsor and no commercial agreement with any AI provider. The "AI" in the name (when it appears) refers to the optional AI scoring step — replaceable with any provider you have a key for, or with no provider at all.',
  },
];

export default function FAQPage() {
  return (
    <div className="container section">
      <div className="page-header" style={{ maxWidth: 780 }}>
        <span className="page-eyebrow">faq</span>
        <h1 className="heading-lg">Real questions, plainly answered.</h1>
        <p className="text-body">
          These are the questions that come up most often when someone first looks at JobPilot. If yours isn&apos;t here, open an issue — the docs grow from real confusion.
        </p>
      </div>

      <div className="faq-list">
        {faqs.map((faq) => (
          <article key={faq.q} className="faq-item">
            <div className="faq-item-q">{faq.q}</div>
            <p className="faq-item-a">{faq.a}</p>
          </article>
        ))}
      </div>

      <div className="cta-strip" style={{ marginTop: 48 }}>
        <div>
          <div className="kicker" style={{ marginBottom: 10 }}>didn&apos;t answer it?</div>
          <h2 className="heading-md" style={{ marginBottom: 8 }}>The docs go deeper, the issues tracker is honest.</h2>
          <p className="muted" style={{ maxWidth: 540 }}>
            Every closed issue stays public. You can see what people asked and exactly how it got solved.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link href="/docs" className="button button-primary">Read the docs</Link>
          <Link href="https://github.com/Tolu-max/JobPilot-Ai/issues" target="_blank" rel="noopener noreferrer" className="button">Open an issue</Link>
        </div>
      </div>
    </div>
  );
}
