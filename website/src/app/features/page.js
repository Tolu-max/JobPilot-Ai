import Link from 'next/link';

export const metadata = { title: 'Features · JobPilot' };

const sections = [
  {
    label: 'scrape',
    summary: 'Find roles across many boards without writing a parser per site.',
    items: [
      {
        title: 'Public APIs over scraping where possible',
        body: 'Greenhouse, Lever, Ashby, Workable, and BambooHR have public job feeds. JobPilot hits those first — no headless browser, no rate-limit games. Sites without an API (RemoteOK, Remotive, WeWorkRemotely, Jobicy, Jobberman…) get hardened HTML scrapers with retries, proper headers, and live-state caching.',
      },
      {
        title: 'Gateway resolution for aggregators',
        body: 'A listing on RemoteOK is often just a link to a Greenhouse board. JobPilot follows the gateway, recognizes the ATS, and runs the right adapter — so a single aggregator entry can flow into the same audited apply path as a direct company posting.',
      },
      {
        title: 'Deduplication that actually works',
        body: 'Hashes by normalized title + company + URL stem. Catches reposts, cross-board mirrors, and the same company posting the same role to three places. Dedup is shared across profiles, so two members of your household don’t both get pinged for the same job.',
      },
      {
        title: 'Recency, location, and language filters',
        body: 'Hard filters live in the profile YAML — country allowlists, language, remote-only toggles, and a freshness floor (default: 14 days). Anything that fails a hard filter never reaches the scorer or the dashboard.',
      },
    ],
  },
  {
    label: 'score',
    summary: 'Decide what’s worth your attention without burning a fortune on tokens.',
    items: [
      {
        title: 'Local matcher runs first',
        body: 'A profile-weighted keyword + skill matcher with role-title fuzzing. Free, runs in microseconds, handles the obvious 70% of decisions. No tokens, no rate limits, no network round-trip.',
      },
      {
        title: 'AI scorer for the close calls',
        body: 'DeepSeek is the default (cheap and surprisingly sharp). Gemini, OpenRouter, and Groq are all wired up — bring whichever key you already have. Routing logic keeps you off the expensive model unless the local matcher genuinely couldn’t decide.',
      },
      {
        title: 'Reasons you can read',
        body: 'Every score comes with a one-line explanation: which skills matched, which gaps were tolerable, why a location was OK. This goes in the Telegram message and the dashboard, so you can approve from your phone without opening the job ad.',
      },
    ],
  },
  {
    label: 'review',
    summary: 'Approve from anywhere, with full context, in one tap.',
    items: [
      {
        title: 'Telegram bot you own',
        body: 'You create the bot with BotFather. The CLI auto-discovers your chat ID, validates the token, and stores it locally. The hosted dashboard never sees your bot token, and no one else can address your bot.',
      },
      {
        title: 'Web dashboard sync',
        body: 'Optional. Approvals made on the web are pulled by the local scheduler on its next tick. You can hand a friend dashboard access without giving them your CLI.',
      },
      {
        title: 'Bulk-approve, bulk-skip',
        body: 'Filter the review queue by source, score, or company, then approve everything that survives the filter in one action. Useful when a trusted board like Remotive drops 30 fresh listings overnight.',
      },
    ],
  },
  {
    label: 'apply',
    summary: 'Submit forms with a real browser, on your machine, with audit trails.',
    items: [
      {
        title: 'Playwright on your machine',
        body: 'No remote browser farm, no third-party RPA service. The runner uses Playwright with your own profile and your own cookies. If a site asks for 2FA, it asks <em>you</em>.',
      },
      {
        title: 'ATS adapters with tests',
        body: 'Greenhouse, Lever, Ashby, Workable, BambooHR — each has a dedicated adapter that knows the form quirks (controlled inputs, country autocompletes, file uploads, screening questions). Each adapter has tests. Unknown ATSes never auto-submit.',
      },
      {
        title: 'AI form answers, with your approval',
        body: 'For long screening questions (&ldquo;why this role&rdquo;, &ldquo;describe a hard project&rdquo;), the answer optimizer drafts a response from your profile and the job context. You can review every answer before submit, or trust the auto-flow per source.',
      },
      {
        title: 'CAPTCHA via CapSolver (optional)',
        body: 'If a site throws a CAPTCHA and you have a CapSolver key, it gets solved. No key, no CAPTCHA bypass — the job routes to review with a screenshot of where it stopped.',
      },
    ],
  },
  {
    label: 'observe',
    summary: 'Know what your runner did, when, and why.',
    items: [
      {
        title: 'Per-run JSON logs',
        body: 'Every run writes a structured log: source health, scrape counts, scoring decisions, review queue diffs, submit results. Grep-friendly. Diff two runs to figure out why yesterday’s good source went dark.',
      },
      {
        title: 'Source health checks',
        body: '<code class="inline-code">jobpilot doctor</code> and the dashboard’s Sources tab flag boards that returned zero results, timed out, or hit a layout change. You see breakage before it costs you a day of missed listings.',
      },
      {
        title: 'Application history',
        body: 'A local SQLite plus the optional cloud table. Search by company, status, source, or date. The CLI uses it to enforce "don’t apply to the same job twice, ever."',
      },
    ],
  },
];

export default function FeaturesPage() {
  return (
    <div className="container section">
      <div className="page-header" style={{ maxWidth: 780 }}>
        <span className="page-eyebrow">features</span>
        <h1 className="heading-lg">Every piece you&apos;d need to build it yourself — only it&apos;s already built.</h1>
        <p className="text-body">
          The shortest fair description: JobPilot is a CLI agent with five jobs — scrape, score, review, apply, observe. Here&apos;s what ships in each.
        </p>
      </div>

      {sections.map((section, idx) => (
        <section key={section.label} style={{ marginBottom: 64 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 8 }}>
            <span className="kicker">stage 0{idx + 1}</span>
            <h2 className="heading-md amber-text">{section.label}</h2>
          </div>
          <p className="text-body" style={{ marginBottom: 12, maxWidth: 720 }}>
            {section.summary}
          </p>

          <div>
            {section.items.map((item, i) => (
              <div key={item.title} className="feature-row">
                <div className="feature-label">
                  <span className="feature-label-num">{String(idx + 1).padStart(2, '0')}.{String(i + 1).padStart(2, '0')}</span>
                  {section.label}
                </div>
                <div>
                  <h3>{item.title}</h3>
                  <p dangerouslySetInnerHTML={{ __html: item.body }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      <div className="cta-strip" style={{ marginTop: 24 }}>
        <div>
          <div className="kicker" style={{ marginBottom: 10 }}>missing something?</div>
          <h2 className="heading-md" style={{ marginBottom: 8 }}>Open a PR. Adapters are intentionally small.</h2>
          <p className="muted" style={{ maxWidth: 540 }}>
            New scraper? ~150 lines + a fixture test. New ATS adapter? Around 300, plus a recorded form trace. The contributor docs walk through both.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link href="/docs" className="button button-primary">Read the docs</Link>
          <Link href="https://github.com/Tolu-max/JobPilot-Ai" target="_blank" rel="noopener noreferrer" className="button">Contributor guide</Link>
        </div>
      </div>
    </div>
  );
}
