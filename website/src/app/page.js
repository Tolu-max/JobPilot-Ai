'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import CommandBlock from '@/components/CommandBlock';
import {
  ArrowRight,
  CheckCircle,
  Cpu,
  FileCheck,
  Gauge,
  Globe,
  LockKeyhole,
  Play,
  ShieldCheck,
} from 'lucide-react';

const SIMULATION_STEPS = [
  { text: 'jobpilot run --profile frontend --limit 50 --review-first', type: 'command' },
  { text: '> Loaded profile: Frontend Engineer', type: 'info' },
  { text: '> Scraping RemoteOK, Remotive, Himalayas, Jobberman, Influx', type: 'info' },
  { text: '> 42 fresh remote roles found after duplicate and location checks', type: 'success' },
  { text: '> Scoring Senior React Developer at RemoteOps Cloud', type: 'info' },
  { text: '  score: 91/100, reason: React, Next.js, forms, remote support', type: 'success' },
  { text: '  status: queued for review in dashboard and Telegram', type: 'applied' },
  { text: '> Scoring Billing Support Specialist at BilingualCare Global', type: 'info' },
  { text: '  score: 38/100, reason: bilingual requirement mismatch', type: 'skipped' },
  { text: '> Browser automation ready for approved jobs only', type: 'success' },
];

const pipeline = [
  {
    icon: Globe,
    title: 'Scrape fresh roles',
    body: 'Pull from implemented remote-job sources with duplicate, country, and recency checks.',
  },
  {
    icon: Gauge,
    title: 'Score fit',
    body: 'Use local matching first, then optional AI providers when the role deserves deeper review.',
  },
  {
    icon: FileCheck,
    title: 'Review safely',
    body: 'Approve, reject, or inspect roles from the dashboard or Telegram before live apply.',
  },
  {
    icon: Play,
    title: 'Apply locally',
    body: 'Run Playwright on your own machine or worker so secrets and browser sessions stay with you.',
  },
];

const trustPoints = [
  'No hosted resume storage by default',
  'No hosted AI or CAPTCHA keys',
  'No job-board passwords on the web app',
  'Dry-run and review-first workflows',
];

export default function Home() {
  const [terminalIndex, setTerminalIndex] = useState(1);
  const [isPlaying, setIsPlaying] = useState(true);

  useEffect(() => {
    if (!isPlaying) return undefined;
    const delay = terminalIndex >= SIMULATION_STEPS.length ? 3600 : 620;
    const timer = setTimeout(() => {
      setTerminalIndex((current) => (current >= SIMULATION_STEPS.length ? 1 : current + 1));
    }, delay);
    return () => clearTimeout(timer);
  }, [terminalIndex, isPlaying]);

  return (
    <>
      <section className="section" style={{ paddingTop: '76px' }}>
        <div className="container" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(360px, 0.9fr)', gap: '44px', alignItems: 'center' }}>
          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="page-eyebrow" style={{ marginBottom: '18px' }}>
              <ShieldCheck size={15} /> Local-first open source automation
            </div>
            <h1 className="heading-xl" style={{ marginBottom: '22px' }}>
              JobPilot runs your job search from the terminal.
            </h1>
            <p className="text-body" style={{ maxWidth: '650px', marginBottom: '28px' }}>
              Scrape remote roles, score them against a CV, review the best matches, and let a local browser apply only when the workflow is approved.
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '28px' }}>
              <CommandBlock command="npm install -g jobpilot-cli" style={{ minWidth: 'min(100%, 360px)' }} />
              <Link href="/docs" className="button button-primary">
                Get Started <ArrowRight size={16} />
              </Link>
              <Link href="/login" className="button">
                Open Dashboard
              </Link>
            </div>

            <div className="grid-2" style={{ maxWidth: '660px' }}>
              {trustPoints.map((point) => (
                <div key={point} style={{ display: 'flex', alignItems: 'center', gap: '9px', color: 'var(--text-muted)' }}>
                  <CheckCircle size={17} style={{ color: 'var(--green)' }} />
                  <span>{point}</span>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.45, delay: 0.12 }} className="panel" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ height: '46px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '0 14px', borderBottom: '1px solid var(--border)', background: '#05070b' }}>
              <div style={{ display: 'flex', gap: '7px' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--red)' }} />
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--amber)' }} />
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--green)' }} />
              </div>
              <span className="mono muted" style={{ fontSize: '0.78rem' }}>jobpilot local runner</span>
              <button type="button" onClick={() => setIsPlaying((value) => !value)} className="button button-ghost icon-button" title={isPlaying ? 'Pause simulation' : 'Play simulation'}>
                <Play size={15} />
              </button>
            </div>
            <div className="mono" style={{ minHeight: '355px', padding: '18px', background: '#05070b', fontSize: '0.86rem', overflow: 'hidden' }}>
              <AnimatePresence initial={false}>
                {SIMULATION_STEPS.slice(0, terminalIndex).map((step, index) => {
                  const color = step.type === 'success' || step.type === 'applied'
                    ? 'var(--green)'
                    : step.type === 'skipped'
                      ? 'var(--text-dim)'
                      : step.type === 'command'
                        ? 'var(--text-main)'
                        : 'var(--text-muted)';

                  return (
                    <motion.div
                      key={`${step.text}-${index}`}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      style={{ color, marginBottom: '8px', whiteSpace: 'pre-wrap' }}
                    >
                      {step.type === 'command' && <span style={{ color: 'var(--green)' }}>PS&gt; </span>}
                      {step.text}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      </section>

      <section className="section" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="container">
          <div className="page-header" style={{ textAlign: 'center', justifyItems: 'center' }}>
            <span className="page-eyebrow"><Cpu size={15} /> Pipeline</span>
            <h2 className="heading-lg">Designed for audited automation</h2>
            <p className="text-body">
              The hosted dashboard gives visibility. The runner keeps secrets, browser profiles, CVs, and provider keys local.
            </p>
          </div>

          <div className="grid-4">
            {pipeline.map((item) => {
              const Icon = item.icon;
              return (
                <section key={item.title} className="card">
                  <div style={{ width: 42, height: 42, display: 'grid', placeItems: 'center', borderRadius: 8, background: 'rgba(79, 140, 255, 0.12)', color: 'var(--accent-light)', marginBottom: 16 }}>
                    <Icon size={21} />
                  </div>
                  <h3 className="heading-sm" style={{ marginBottom: 9 }}>{item.title}</h3>
                  <p className="muted" style={{ lineHeight: 1.65 }}>{item.body}</p>
                </section>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="container" style={{ display: 'grid', gridTemplateColumns: '0.85fr 1.15fr', gap: '32px', alignItems: 'start' }}>
          <div>
            <span className="page-eyebrow"><LockKeyhole size={15} /> Security model</span>
            <h2 className="heading-lg" style={{ margin: '14px 0 12px' }}>Hosted dashboard, local automation.</h2>
            <p className="text-body">
              JobPilot is built for open-source users who may not want to trust a hosted app with their API keys or resumes. The web UI stays focused on safe metadata, approvals, and analytics.
            </p>
          </div>
          <div className="panel">
            <div className="grid-2">
              {[
                ['Web app stores', 'Job title, company, score, source, status, timestamps, safe profile labels.'],
                ['CLI stores locally', 'CVs, AI provider keys, CAPTCHA solver keys, browser sessions, job-board credentials.'],
                ['Dashboard controls', 'Review approvals, rejects, queue status, history, source performance.'],
                ['Runner controls', 'Scheduler, apply driver, screenshots, CAPTCHA solving, profile files.'],
              ].map(([title, body]) => (
                <div key={title}>
                  <h3 className="heading-sm" style={{ marginBottom: 8 }}>{title}</h3>
                  <p className="muted" style={{ lineHeight: 1.65 }}>{body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <style jsx>{`
        @media (max-width: 900px) {
          section :global(.container) {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </>
  );
}
