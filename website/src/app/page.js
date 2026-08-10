'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight, CheckCircle2, LockKeyhole, Play, Radar, ShieldCheck, Terminal, Workflow } from 'lucide-react';
import CommandBlock from '@/components/CommandBlock';
import InteractiveCLI from '@/components/InteractiveCLI';
import Reveal from '@/components/Reveal';

const SOURCES = [
  ['bruntwork', 'apply ready'],
  ['jobberman', 'review first'],
  ['greenhouse', 'adapter'],
  ['lever', 'adapter'],
  ['ashby', 'adapter'],
  ['workable', 'adapter'],
  ['weworkremotely', 'scraper'],
  ['jobicy', 'api'],
  ['remoteok', 'scraper'],
  ['workingnomads', 'scraper'],
  ['themuse', 'api'],
  ['arbeitnow', 'api'],
];

const PIPELINE = [
  { label: 'Scrape', value: '89 roles', detail: 'BruntWork, Jobberman, remote boards' },
  { label: 'Filter', value: '31 kept', detail: 'senior/devops/low-fit roles removed' },
  { label: 'Score', value: '7 strong', detail: 'local matcher first, AI only when useful' },
  { label: 'Approve', value: 'Telegram', detail: 'you approve before forms submit' },
];

const PRINCIPLES = [
  { icon: LockKeyhole, title: 'Secrets stay local', body: 'Resume files, API keys, browser cookies, CAPTCHA keys, Telegram tokens, and logs stay on your machine.' },
  { icon: Workflow, title: 'Review-first automation', body: 'Unknown sites and risky forms stop at review. Apply handlers only submit when the path is known.' },
  { icon: Radar, title: 'Source-by-source control', body: 'Run BruntWork hard, keep Jobberman in review mode, add more boards without changing your workflow.' },
];

export default function Home() {
  return (
    <>
      <section className="jp-hero">
        <div className="container jp-hero-grid">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="jp-hero-copy"
          >
            <div className="jp-kicker">
              <ShieldCheck size={15} />
              local-first job automation
            </div>
            <h1 className="jp-hero-title">JobPilot runs the job hunt from your laptop.</h1>
            <p className="jp-hero-lede">
              Scrape the right boards, score roles against a profile, approve from Telegram, and let a local browser handle known application flows.
            </p>
            <div className="jp-hero-actions">
              <Link href="/docs#install" className="button button-primary">
                Start locally <ArrowRight size={16} />
              </Link>
              <Link href="/dashboard" className="button">
                Open dashboard
              </Link>
            </div>
            <div className="jp-command-row">
              <CommandBlock command="npm install -g jobpilot-cli" />
              <CommandBlock command="jobpilot run --profile=tolu --review-first" />
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            className="jp-run-panel"
          >
            <div className="jp-run-header">
              <div>
                <span>today&apos;s local run</span>
                <strong>review-first mode</strong>
              </div>
              <Play size={18} />
            </div>
            <div className="jp-pipeline-list">
              {PIPELINE.map((item, index) => (
                <div className="jp-pipeline-item" key={item.label}>
                  <span className="jp-pipeline-index">{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <strong>{item.label}</strong>
                    <p>{item.detail}</p>
                  </div>
                  <b>{item.value}</b>
                </div>
              ))}
            </div>
            <div className="jp-run-footer">
              <span><CheckCircle2 size={14} /> 0 secrets uploaded</span>
              <span><CheckCircle2 size={14} /> 0 unapproved submits</span>
            </div>
          </motion.div>
        </div>
      </section>

      <section className="section jp-section-tight">
        <div className="container">
          <Reveal>
            <div className="jp-section-head">
              <div>
                <div className="kicker">source coverage</div>
                <h2 className="heading-lg">Start with the boards that matter, then add more safely.</h2>
              </div>
              <Link href="/dashboard/sources" className="button">Manage sources</Link>
            </div>
          </Reveal>
          <div className="jp-source-grid">
            {SOURCES.map(([name, mode]) => (
              <div className="jp-source-row" key={name}>
                <span>{name}</span>
                <small>{mode}</small>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section jp-section-tight">
        <div className="container jp-principles">
          {PRINCIPLES.map(({ icon: Icon, title, body }) => (
            <Reveal key={title}>
              <article className="jp-principle">
                <Icon size={20} />
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="section jp-cli-section">
        <div className="container jp-cli-grid">
          <Reveal>
            <div>
              <div className="kicker">CLI</div>
              <h2 className="heading-lg">A calm command center for scraping, scoring, and applying.</h2>
              <p className="text-body">
                The website is the view. The CLI is the engine. Run one profile, run the scheduler for both Tolu and sister, pause from Telegram, and inspect every decision.
              </p>
              <div className="jp-cli-notes">
                <span><Terminal size={15} /> local runner</span>
                <span><ShieldCheck size={15} /> review gates</span>
                <span><Radar size={15} /> per-source controls</span>
              </div>
            </div>
          </Reveal>
          <Reveal delay={0.08}>
            <InteractiveCLI />
          </Reveal>
        </div>
      </section>
    </>
  );
}
