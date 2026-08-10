'use client';

import { motion } from 'framer-motion';
import CommandBlock from '@/components/CommandBlock';

const sections = [
  {
    id: 'install',
    label: '01',
    title: 'Install the CLI',
    body: 'JobPilot runs on Node 20+. Install globally so the jobpilot command is on your PATH. The CLI is the source of truth — the dashboard is optional from here on out.',
    command: 'npm install -g jobpilot-cli',
    note: 'Verify with `jobpilot --version`. Playwright will download its bundled browsers on first run (~150 MB).',
  },
  {
    id: 'init',
    label: '02',
    title: 'Create a profile',
    body: 'A profile bundles your resume, source list, hard filters, scoring weights, Telegram bot, and any AI keys. Profiles live under ~/.jobpilot/profiles/<name>/ and never leave the machine.',
    command: 'jobpilot init --profile=me',
    list: [
      ['resume', 'Point at a local PDF, DOCX, or TXT. Parsed into structured profile.yaml; original file stays put.'],
      ['sources', 'Pick from the wired-up boards. Start conservative (3–5) and grow.'],
      ['filters', 'Country allowlist, remote-only toggle, language, role-title keywords, freshness floor.'],
      ['scoring', 'Local matcher is on by default. Add an AI key only if you want tiebreakers.'],
    ],
  },
  {
    id: 'doctor',
    label: '03',
    title: 'Verify with doctor',
    body: 'Runs profile validation, env-var checks, Playwright browser checks, source connectivity, and shows what would sync to the dashboard if you logged in. Run it again after any config edit.',
    command: 'jobpilot doctor --profile=me',
    note: 'Failing checks print exactly what to fix and where. Doctor never makes network calls to job-board apply endpoints.',
  },
  {
    id: 'telegram',
    label: '04',
    title: 'Wire up Telegram (optional)',
    body: 'Approving jobs from your phone beats opening the dashboard for every notification. Create a bot with @BotFather, get the token, and let the CLI link it.',
    command: 'jobpilot telegram --profile=me',
    note: 'The CLI auto-discovers your chat ID (send the bot any message). Token stored locally under ~/.jobpilot/profiles/me/. The hosted dashboard never gets it.',
  },
  {
    id: 'login',
    label: '05',
    title: 'Link the dashboard (optional)',
    body: 'Spins up a localhost loopback on a random port, opens your browser to the dashboard sign-in, hands the session back to the loopback when sign-in completes. No token paste.',
    command: 'jobpilot login',
    note: 'Sync is metadata-only by design: title, company, score, status, URL, source, timestamps. Revoke any time from /dashboard/settings or with `jobpilot logout`.',
  },
  {
    id: 'run',
    label: '06',
    title: 'First run (foreground, review-first)',
    body: 'Always do one foreground pass before scheduling. Watch the output, sanity-check what gets queued.',
    command: 'jobpilot run --profile=me --limit 50 --review-first',
    note: 'Approve a few, skip a few, watch how the runner handles unknown ATSes (they should route to review, never auto-submit).',
  },
  {
    id: 'scheduler',
    label: '07',
    title: 'Run continuously',
    body: 'The scheduler ticks on an interval (default 15m), respecting per-source rate limits and time-of-day windows. Survives crashes; resumes from local SQLite state.',
    command: 'jobpilot scheduler --profile=me',
    note: 'On a server, wrap in systemd / pm2 / a Railway worker. On a laptop, run inside a tmux pane or as a launchd / Task Scheduler job.',
  },
];

const release = [
  ['unit tests', 'Covers scorer, onboarding, adapters, scraper policies, local state.', 'npm test'],
  ['scraper readiness', 'Confirms every registered scraper has matching configuration.', 'npm run scrapers:check'],
  ['website lint', 'Validates the Next.js frontend before publishing dashboard changes.', 'npm --prefix website run lint'],
  ['website build', 'Builds public pages and the authenticated dashboard.', 'npm --prefix website run build'],
  ['release gate', 'Fails the commit if resumes, audio, real profiles, or .env files leak in.', 'npm run release:check'],
];

function Inline({ text }) {
  return String(text).split(/(`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="inline-code">{part.slice(1, -1)}</code>;
    }
    return <span key={i}>{part}</span>;
  });
}

export default function DocsClient() {
  return (
    <div className="container section" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 240px', gap: 56, alignItems: 'start' }}>
      <div style={{ minWidth: 0 }}>
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="page-header"
          style={{ maxWidth: 780 }}
        >
          <span className="page-eyebrow">docs · quickstart</span>
          <h1 className="heading-lg">From <code className="inline-code">npm install</code> to reviewing roles in about ten minutes.</h1>
          <p className="text-body">
            This guide is the path the maintainers walk on a new machine. Every step has a doctor check, an exit, and a default that does not surprise you.
          </p>
        </motion.div>

        <div style={{ display: 'grid', gap: 22 }}>
          {sections.map((sec, idx) => (
            <motion.section
              key={sec.id}
              id={sec.id}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-50px' }}
              transition={{ duration: 0.4, delay: idx * 0.04 }}
              className="panel"
              style={{ scrollMarginTop: 96, display: 'grid', gap: 14 }}
            >
              <div style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
                <span className="kicker">{sec.label}</span>
                <h2 className="heading-md">{sec.title}</h2>
              </div>
              <p className="text-body" style={{ maxWidth: 720 }}>{sec.body}</p>
              <CommandBlock command={sec.command} />
              {sec.note && (
                <p className="dim" style={{ fontSize: '0.88rem', lineHeight: 1.6 }}>
                  <Inline text={sec.note} />
                </p>
              )}
              {sec.list && (
                <ul style={{ listStyle: 'none', display: 'grid', gap: 6, marginTop: 6 }}>
                  {sec.list.map(([k, v]) => (
                    <li key={k} style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 14, padding: '10px 0', borderTop: '1px solid var(--line)' }}>
                      <strong style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.82rem', color: 'var(--amber)', textTransform: 'lowercase' }}>{k}</strong>
                      <span className="muted" style={{ lineHeight: 1.6 }}>{v}</span>
                    </li>
                  ))}
                </ul>
              )}
            </motion.section>
          ))}

          <motion.section
            id="release"
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4 }}
            className="panel"
            style={{ scrollMarginTop: 96, display: 'grid', gap: 16 }}
          >
            <div style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
              <span className="kicker">contributors</span>
              <h2 className="heading-md">Before opening a PR</h2>
            </div>
            <p className="text-body" style={{ maxWidth: 720 }}>
              JobPilot is open source, but applicant data is not. The release gate refuses to ship if real profiles, resumes, browser recordings, or .env files have leaked in. Run it locally before pushing.
            </p>
            <div style={{ display: 'grid', gap: 14 }}>
              {release.map(([title, body, cmd]) => (
                <div key={title} style={{ display: 'grid', gap: 8, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                    <h3 className="heading-sm" style={{ fontFamily: 'IBM Plex Mono, monospace' }}>{title}</h3>
                    <span className="dim" style={{ fontSize: '0.82rem' }}>{body}</span>
                  </div>
                  <CommandBlock command={cmd} />
                </div>
              ))}
            </div>
          </motion.section>
        </div>
      </div>

      <motion.aside
        initial={{ opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4, delay: 0.15 }}
        className="panel"
        style={{ position: 'sticky', top: 96, display: 'grid', gap: 4, padding: 18 }}
      >
        <div className="kicker" style={{ marginBottom: 10 }}>on this page</div>
        {sections.map((sec) => (
          <a key={sec.id} href={`#${sec.id}`} className="site-nav-link" style={{ fontSize: '0.88rem', padding: '5px 0' }}>
            <span style={{ color: 'var(--paper-dim)', marginRight: 8 }}>{sec.label}</span>
            {sec.title}
          </a>
        ))}
        <hr className="rule" style={{ margin: '8px 0' }} />
        <a href="#release" className="site-nav-link" style={{ fontSize: '0.88rem', padding: '5px 0', color: 'var(--green)' }}>Release checks</a>
      </motion.aside>

      <style jsx>{`
        @media (max-width: 960px) {
          div.container {
            grid-template-columns: 1fr !important;
          }
          aside {
            position: static !important;
          }
        }
      `}</style>
    </div>
  );
}
