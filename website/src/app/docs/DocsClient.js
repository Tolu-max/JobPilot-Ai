"use client";

import { motion } from 'framer-motion';
import CommandBlock from '@/components/CommandBlock';

const sections = [
  {
    id: 'install',
    title: '1. Install the CLI',
    content: 'Install JobPilot on the machine that will own the resumes, browser sessions, provider keys, and scheduler.',
    command: 'npm install -g jobpilot-cli',
    details: 'The `jobpilot` command runs locally. The hosted dashboard is optional and should only receive safe job metadata.',
  },
  {
    id: 'profile',
    title: '2. Create a private profile',
    content: 'Use terminal onboarding to parse a CV, choose sources, set hard filters, and write profile files under your local profiles folder.',
    command: 'jobpilot init --profile=<profile>',
    list: [
      { label: 'Resume', desc: 'Use a local PDF, DOCX, or TXT file path.' },
      { label: 'Sources', desc: 'Start with implemented scrapers and conservative per-site limits.' },
      { label: 'Scoring', desc: 'Use local matching first; add Gemini, OpenRouter, or Groq only when needed.' },
      { label: 'Safety', desc: 'Keep dry-run and review-first enabled until each apply flow has been audited.' },
    ],
  },
  {
    id: 'doctor',
    title: '3. Check the runner',
    content: 'Validate the profile, resume path, environment variables, browser requirements, and local state before scraping jobs.',
    command: 'jobpilot doctor --profile=<profile>',
    details: 'Run `jobpilot doctor` again after editing `.env`, changing sources, or moving profile files.',
  },
  {
    id: 'telegram',
    title: '4. Link Telegram',
    content: 'Create your own Telegram bot with BotFather, then let the CLI discover the chat and store the token locally.',
    command: 'jobpilot telegram --profile=<profile>',
    details: 'Telegram can show review queues, approve jobs, skip jobs, and report scheduler status without putting the bot token in the hosted dashboard.',
  },
  {
    id: 'dashboard',
    title: '5. Optional dashboard sync',
    content: 'Use dashboard auth when you want web review queues, application history, source analytics, and approval controls.',
    command: 'jobpilot login',
    details: 'After login, the CLI syncs job title, company, score, source, status, and timestamps. It should not sync CVs, API keys, CAPTCHA keys, cookies, or job-board passwords.',
  },
  {
    id: 'scheduler',
    title: '6. Run automation',
    content: 'Start with one foreground pass, review the results, then run the scheduler from a trusted local machine or private worker.',
    command: 'jobpilot run --profile=<profile> --limit 50 --review-first',
    details: 'When the flow is tested, use `jobpilot scheduler --profile=<profile>` for the continuous runner.',
  },
];

const releaseChecks = [
  {
    title: 'Unit tests',
    body: 'Checks scoring, onboarding, adapters, scraper policies, and local state behavior.',
    command: 'npm test',
  },
  {
    title: 'Scraper readiness',
    body: 'Confirms every registered scraper has matching configuration and safe enabled state.',
    command: 'npm run scrapers:check',
  },
  {
    title: 'Website lint',
    body: 'Validates the Next.js frontend before publishing dashboard changes.',
    command: 'npm --prefix website run lint',
  },
  {
    title: 'Website build',
    body: 'Builds the public pages and authenticated dashboard routes.',
    command: 'npm --prefix website run build',
  },
  {
    title: 'Private-file release gate',
    body: 'Fails if resumes, audio files, real profiles, logs, or other private artifacts are still inside the repo.',
    command: 'npm run release:check',
  },
];

function InlineText({ text }) {
  return String(text).split(/(`[^`]+`)/g).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index} className="inline-code">{part.slice(1, -1)}</code>;
    }
    return <span key={index}>{part}</span>;
  });
}

export default function DocsClient() {
  return (
    <div className="container section" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: '44px', alignItems: 'start' }}>
      <div style={{ minWidth: 0 }}>
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="page-header"
          style={{ marginBottom: '48px', maxWidth: 780 }}
        >
          <span className="page-eyebrow">Docs</span>
          <h1 className="heading-lg">Run JobPilot without handing over private job-search data.</h1>
          <p className="text-body">
            This guide keeps the responsibilities clear: the CLI scrapes, scores, stores secrets, and drives the browser; the web dashboard reviews safe metadata and approvals.
          </p>
        </motion.div>

        <div style={{ display: 'grid', gap: '34px' }}>
          {sections.map((sec, index) => (
            <motion.section
              key={sec.id}
              id={sec.id}
              initial={{ opacity: 0, y: 22 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-50px' }}
              transition={{ duration: 0.45, delay: index * 0.05 }}
              className="panel"
              style={{ scrollMarginTop: '100px' }}
            >
              <h2 className="heading-md" style={{ marginBottom: 10 }}>{sec.title}</h2>
              <p className="text-body" style={{ marginBottom: 18 }}>{sec.content}</p>
              <CommandBlock command={sec.command} style={{ marginBottom: sec.details || sec.list ? 18 : 0 }} />

              {sec.details && (
                <p className="text-body" style={{ fontSize: '0.98rem' }}>
                  <InlineText text={sec.details} />
                </p>
              )}

              {sec.list && (
                <div style={{ display: 'grid', gap: 10 }}>
                  {sec.list.map((item) => (
                    <div key={item.label} style={{ padding: '14px 16px', borderLeft: '2px solid var(--accent-light)', borderRadius: '0 8px 8px 0', background: 'rgba(255,255,255,0.025)' }}>
                      <strong>{item.label}:</strong> <span className="muted">{item.desc}</span>
                    </div>
                  ))}
                </div>
              )}
            </motion.section>
          ))}

          <motion.section
            id="release"
            initial={{ opacity: 0, y: 22 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.45 }}
            className="panel"
            style={{ scrollMarginTop: '100px' }}
          >
            <span className="page-eyebrow" style={{ marginBottom: 14 }}>Contributors</span>
            <h2 className="heading-md" style={{ marginBottom: 10 }}>Before opening a pull request or publishing a fork</h2>
            <p className="text-body" style={{ marginBottom: 22 }}>
              JobPilot is open source, but applicant data is not. Move real profiles, resumes, audio files, browser sessions, logs, and `.env` outside the repo before publishing.
            </p>
            <div style={{ display: 'grid', gap: 16 }}>
              {releaseChecks.map((check) => (
                <article key={check.title} style={{ display: 'grid', gap: 10 }}>
                  <div>
                    <h3 className="heading-sm" style={{ marginBottom: 4 }}>{check.title}</h3>
                    <p className="muted">{check.body}</p>
                  </div>
                  <CommandBlock command={check.command} />
                </article>
              ))}
            </div>
          </motion.section>
        </div>
      </div>

      <motion.aside
        initial={{ opacity: 0, x: 18 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.45, delay: 0.15 }}
        className="panel"
        style={{ position: 'sticky', top: 96, display: 'grid', gap: 12 }}
      >
        <div style={{ fontSize: '0.78rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 750 }}>On this page</div>
        {sections.map((sec) => (
          <a key={sec.id} href={`#${sec.id}`} className="site-nav-link">{sec.title.replace(/^\d+\.\s*/, '')}</a>
        ))}
        <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
        <a href="#release" className="site-nav-link" style={{ color: 'var(--green)' }}>Release checks</a>
      </motion.aside>

      <style jsx>{`
        @media (max-width: 920px) {
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
