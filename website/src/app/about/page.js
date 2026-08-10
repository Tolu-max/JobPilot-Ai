import Link from 'next/link';

export const metadata = { title: 'About · JobPilot' };

const principles = [
  {
    title: 'Local is not a checkbox — it&rsquo;s the architecture.',
    body: 'Plenty of tools call themselves &ldquo;privacy-respecting&rdquo; then quietly upload your resume to embed it for matching. JobPilot is built the other way: the CLI is the source of truth, the web is a thin reflector, and the boundary between them is documented per data type. If a feature can&apos;t respect the boundary, it doesn&apos;t ship in that form.',
  },
  {
    title: 'Audited before automated.',
    body: 'Submitting a form on your behalf is high-blast-radius. New ATSes ship in &ldquo;manual review&rdquo; mode by default and only graduate to auto-apply after the form quirks are mapped, a test fixture exists, and the trace is recorded. The cost of a bad apply is a real human looking at a bad application — we treat it that way.',
  },
  {
    title: 'Cheap by design.',
    body: 'The local matcher does the heavy lifting on free CPU. AI is a tiebreaker. Default routing is DeepSeek because it&apos;s sharp and pennies-per-month. A serious search should not cost you a hundred dollars in OpenAI bills — and if it does, something is wired wrong.',
  },
  {
    title: 'Contributable in one afternoon.',
    body: 'Adapters and scrapers are intentionally small. A new scraper is ~150 lines and a fixture. A new ATS adapter is ~300 lines and a recorded trace. The point is to keep the on-ramp low so coverage grows.',
  },
];

const story = [
  {
    when: '2025',
    what: 'Built it for one search.',
    body: 'Spent a week of evenings hand-applying to ~80 roles. The pattern was obvious, repetitive, and a perfect target for a tool I could trust because I&apos;d written it. The first version was a Node script and a Telegram bot.',
  },
  {
    when: 'early 2026',
    what: 'Helped a sibling pivot.',
    body: 'They needed something pointed at different boards with different filters. That forced the multi-profile rewrite and the dedup-across-profiles work. The dashboard came later when reviewing 40 roles a day on Telegram got annoying.',
  },
  {
    when: 'mid 2026',
    what: 'Open-sourced it.',
    body: 'Other people kept asking if they could use it. Open source was the only honest answer — a job-application bot you can&apos;t audit is not a tool you should trust. The boundary between CLI and dashboard is what makes the open-sourcing safe.',
  },
];

export default function AboutPage() {
  return (
    <div className="container section">
      <div className="page-header" style={{ maxWidth: 820 }}>
        <span className="page-eyebrow">about</span>
        <h1 className="heading-lg">JobPilot is what happened when one annoying job search turned into a tool, then into a small open project.</h1>
        <p className="text-body">
          It is not a startup. It is not trying to be the AI auto-apply bot. It is an honest, opinionated, MIT-licensed agent that does one thing well: pull jobs in, score them, and let you approve which ones get applied to — from your own machine, on your own terms.
        </p>
      </div>

      <section style={{ marginBottom: 56 }}>
        <div className="kicker" style={{ marginBottom: 14 }}>principles</div>
        <h2 className="heading-md" style={{ marginBottom: 22, maxWidth: 720 }}>
          Four things JobPilot will not trade away for growth.
        </h2>
        <div className="grid-2">
          {principles.map((p) => (
            <article key={p.title} className="panel" style={{ display: 'grid', gap: 12 }}>
              <h3 className="heading-sm" style={{ fontFamily: 'IBM Plex Mono, monospace' }} dangerouslySetInnerHTML={{ __html: p.title }} />
              <p className="muted" style={{ lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: p.body }} />
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginBottom: 56 }}>
        <div className="kicker" style={{ marginBottom: 14 }}>history</div>
        <h2 className="heading-md" style={{ marginBottom: 22, maxWidth: 720 }}>
          A short, honest origin story.
        </h2>

        <div className="changelog-rail">
          {story.map((s) => (
            <div key={s.when} className="changelog-item">
              <div className="changelog-meta">
                <span className="changelog-version">{s.when}</span>
              </div>
              <h3 className="changelog-title">{s.what}</h3>
              <p className="muted" style={{ lineHeight: 1.7, maxWidth: 660 }} dangerouslySetInnerHTML={{ __html: s.body }} />
            </div>
          ))}
        </div>
      </section>

      <div className="cta-strip">
        <div>
          <div className="kicker" style={{ marginBottom: 10 }}>get involved</div>
          <h2 className="heading-md" style={{ marginBottom: 8 }}>If this is useful to you, file an issue. If it&apos;s broken, send a fix.</h2>
          <p className="muted" style={{ maxWidth: 540 }}>
            Coverage grows by users contributing scrapers for boards they care about. The contributor docs and code are deliberately small enough to read in an afternoon.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link href="https://github.com/Tolu-max/JobPilot-Ai" target="_blank" rel="noopener noreferrer" className="button button-primary">View on GitHub →</Link>
          <Link href="/docs" className="button">Read the docs</Link>
        </div>
      </div>
    </div>
  );
}
