'use client';

import { motion } from 'framer-motion';

const RELEASES = [
  {
    version: 'v1.0.3',
    date: 'June 2026',
    title: 'Public API scrapers + Ashby adapter',
    note: 'More sources, cleaner data — hitting public APIs where they exist instead of scraping HTML.',
    changes: [
      { type: 'add',  text: 'Public-API scrapers for Ashby, Arbeitnow, Jobicy, RealWorkFromAnywhere, The Muse, Working Nomads, WeWorkRemotely.' },
      { type: 'add',  text: 'BambooHR ATS adapter: public job feed + Playwright form handler with integration tests.' },
      { type: 'add',  text: 'AI form-answer support for Ashby long screening questions — drafted from your profile, you approve before submit.' },
      { type: 'fix',  text: 'Default scheduler tick moved to 15m. Bruntwork and Jobberman capped at 10 jobs/pass to respect rate limits.' },
      { type: 'fix',  text: 'Switched default AI router to DeepSeek. Gemini and OpenRouter still available via env var.' },
    ],
  },
  {
    version: 'v1.0.2',
    date: 'June 2026',
    title: 'Open-source hardening',
    note: 'Made the repo safe to publish without leaking real applicant data.',
    changes: [
      { type: 'add',  text: 'Release gate script — CI fails if resumes, audio, real profiles, or .env files are present in git.' },
      { type: 'add',  text: 'GitHub issue templates, contributor docs, CI workflow scoped to lint + unit tests only (no live automation in CI).' },
      { type: 'add',  text: 'Example profile and .env template ship with safe defaults: dry-run on, review-first on.' },
      { type: 'fix',  text: 'Dashboard API defaults reverted to local config — no assumption of a hosted endpoint.' },
    ],
  },
  {
    version: 'v1.0.1',
    date: 'May 2026',
    title: 'Scraper coverage + apply audit',
    note: 'First major expansion of sources and the routing logic that decides when a role can auto-submit.',
    changes: [
      { type: 'add',  text: 'Implemented scrapers: RemoteOK, Remotive, Jobberman, RemoteJobsOrg, Influx, BruntWork, Wellfound (scrape-only).' },
      { type: 'add',  text: 'Gateway resolution — aggregator listings follow through to the underlying ATS before the adapter check.' },
      { type: 'fix',  text: 'Greenhouse controlled-input handling for country autocomplete fields.' },
      { type: 'tune', text: 'AI calls deferred until local matcher confidence is below threshold — ~70% cost reduction per run.' },
    ],
  },
  {
    version: 'v1.0.0',
    date: 'May 2026',
    title: 'Initial release',
    note: 'First working version: CLI agent that scrapes, scores, queues for Telegram review, and applies locally via Playwright.',
    changes: [
      { type: 'add',  text: 'Terminal onboarding wizard — CV parsing, source selection, filter config, saved to local profile.yaml.' },
      { type: 'add',  text: 'Local job dedup, per-profile state, review queue, and continuous scheduler.' },
      { type: 'add',  text: 'Optional AI scoring via DeepSeek / Gemini / OpenRouter / Groq.' },
      { type: 'add',  text: 'Web dashboard: overview, review queue, sources, history, runner commands, setup.' },
    ],
  },
];

const TAG_CLASS = { add: 'tag tag-add', fix: 'tag tag-fix', tune: 'tag tag-tune' };

export default function Changelog() {
  return (
    <div className="container section">
      <div className="page-header" style={{ maxWidth: 780 }}>
        <span className="page-eyebrow">changelog</span>
        <h1 className="heading-lg">What shipped, when, and why it mattered.</h1>
        <p className="text-body">
          JobPilot shipped its first working version in May 2026. Versioned with semver — patch for fixes, minor for new scrapers or adapters, major for breaking profile or dashboard contract changes.
        </p>
      </div>

      <div className="changelog-rail">
        {RELEASES.map((release, idx) => (
          <motion.div
            key={release.version}
            className="changelog-item"
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.4, delay: idx * 0.06 }}
          >
            <div className="changelog-meta">
              <span className="changelog-version">{release.version}</span>
              <span className="changelog-date">{release.date}</span>
            </div>
            <h2 className="changelog-title">{release.title}</h2>
            <p className="text-body" style={{ marginBottom: 18, maxWidth: 720 }}>{release.note}</p>
            <ul className="changelog-changes">
              {release.changes.map((c, i) => (
                <li key={i}>
                  <span className={TAG_CLASS[c.type] || 'tag'}>{c.type}</span>
                  <span>{c.text}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
