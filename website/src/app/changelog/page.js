'use client';
import { motion } from 'framer-motion';
import { Sparkles, GitCommit } from 'lucide-react';

const RELEASES = [
  {
    version: 'v1.0.2',
    date: 'May 2026',
    title: 'Local-first public hardening',
    description: 'Public defaults now match the open-source safety model: review-first automation, local secrets, CI-only GitHub Actions, and a release gate for private files.',
    type: 'major',
    changes: [
      { type: 'feature', text: 'Added safety docs, release checklist, GitHub issue templates, and a CI workflow that does not run applicant automation.' },
      { type: 'feature', text: 'Set the example profile and environment template to dry-run, review-first defaults.' },
      { type: 'fix', text: 'Moved dashboard API defaults back to local configuration instead of assuming a hosted endpoint.' },
      { type: 'perf', text: 'Kept release checks fast while still blocking resumes, audio files, real profiles, and private artifacts.' }
    ]
  },
  {
    version: 'v1.0.1',
    date: 'April 2026',
    title: 'Scraper and apply-flow audit',
    description: 'The runner became more careful about source freshness, profile fit, downstream ATS routing, and when a real submit is allowed.',
    type: 'minor',
    changes: [
      { type: 'feature', text: 'Added implemented-source checks for RemoteOK, Remotive, Himalayas, Jobberman, RemoteJobs.org, Influx, BruntWork, and Wellfound scrape-only flows.' },
      { type: 'feature', text: 'Added gateway handling so source boards can resolve company apply pages before audited adapter checks.' },
      { type: 'fix', text: 'Improved Greenhouse controlled inputs and country autocomplete handling before live-submit audits.' },
      { type: 'perf', text: 'Reduced unnecessary AI calls by relying on local matching before provider scoring.' }
    ]
  },
  {
    version: 'v1.0.0',
    date: 'March 2026',
    title: 'CLI and dashboard foundation',
    description: 'The first public foundation joined terminal onboarding, profile-scoped state, optional dashboard sync, Telegram review controls, and local browser automation.',
    type: 'major',
    changes: [
      { type: 'feature', text: 'Created the interactive onboarding wizard for local profiles and resume parsing.' },
      { type: 'feature', text: 'Added local job history, review queues, profile preferences, and cross-profile duplicate checks.' },
      { type: 'feature', text: 'Added optional AI provider routing for fit scoring and application-question answers.' },
      { type: 'feature', text: 'Added the dashboard routes for overview, queue, history, runner commands, source status, and setup.' }
    ]
  }
];

function ChangelogNode({ release, idx }) {
  return (
    <div style={{ display: 'flex', gap: '30px', position: 'relative', marginBottom: '60px' }}>
      
      {/* Visual Timeline Node */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
        <div style={{ 
          width: '40px', 
          height: '40px', 
          borderRadius: '50%', 
          background: release.type === 'major' ? 'var(--accent)' : '#1e293b', 
          border: '2px solid var(--border-highlight)',
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          color: '#fff',
          zIndex: 5
        }}>
          {release.type === 'major' ? <Sparkles size={18} /> : <GitCommit size={18} />}
        </div>
        {/* Vertical line connection */}
        {idx < RELEASES.length - 1 && (
          <div style={{ 
            position: 'absolute', 
            top: '40px', 
            bottom: '-60px', 
            width: '2px', 
            background: 'linear-gradient(to bottom, var(--border-highlight), transparent)' 
          }} />
        )}
      </div>

      {/* Content Card */}
      <motion.div 
        initial={{ opacity: 0, x: 20 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.4, delay: idx * 0.1 }}
        className="glass-card" 
        style={{ padding: '30px', flexGrow: 1 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
          <div>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--accent-light)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{release.date}</span>
            <h2 className="heading-md" style={{ color: '#fff', marginTop: '4px' }}>{release.title}</h2>
          </div>
          <span style={{ 
            background: 'var(--border)', 
            border: '1px solid var(--border-highlight)', 
            padding: '6px 14px', 
            borderRadius: '8px', 
            fontSize: '0.85rem', 
            fontWeight: 700,
            color: '#fff',
            fontFamily: 'monospace'
          }}>
            {release.version}
          </span>
        </div>

        <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: 1.6, marginBottom: '24px' }}>{release.description}</p>

        <div style={{ width: '100%', height: '1px', background: 'var(--border)', marginBottom: '20px' }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {release.changes.map((change, cIdx) => (
            <div key={cIdx} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', fontSize: '0.925rem' }}>
              <span style={{ 
                background: change.type === 'feature' ? 'rgba(16, 185, 129, 0.15)' : change.type === 'fix' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(129, 140, 248, 0.15)', 
                color: change.type === 'feature' ? 'var(--green)' : change.type === 'fix' ? '#ef4444' : 'var(--accent-light)',
                fontSize: '0.75rem', 
                fontWeight: 700, 
                padding: '3px 8px', 
                borderRadius: '6px',
                textTransform: 'uppercase',
                marginTop: '1px',
                flexShrink: 0
              }}>
                {change.type}
              </span>
              <span style={{ color: 'var(--text-muted)' }}>{change.text}</span>
            </div>
          ))}
        </div>
      </motion.div>

    </div>
  );
}

export default function Changelog() {
  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '60px 24px 100px' }}>
      
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '80px' }}>
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 12px', background: 'rgba(79, 140, 255, 0.12)', border: '1px solid var(--border-highlight)', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, color: 'var(--accent-light)', marginBottom: '16px' }}
        >
          Product Timeline
        </motion.div>
        <motion.h1 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="heading-lg"
          style={{ color: '#fff' }}
        >
          Release history & changelog.
        </motion.h1>
        <motion.p 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="text-body"
          style={{ marginTop: '12px' }}
        >
          Track the parts that matter for contributors: safety defaults, scraper coverage, audited apply flows, and dashboard sync.
        </motion.p>
      </div>

      {/* Timeline nodes */}
      <div style={{ paddingLeft: '10px' }}>
        {RELEASES.map((release, idx) => (
          <ChangelogNode key={idx} release={release} idx={idx} />
        ))}
      </div>

    </div>
  );
}
