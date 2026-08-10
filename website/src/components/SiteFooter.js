'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import { motion, useMotionValue, useTransform, useSpring } from 'framer-motion';

const COLS = [
  {
    label: 'project',
    links: [
      { href: '/features',  label: 'features' },
      { href: '/docs',      label: 'documentation' },
      { href: '/security',  label: 'security model' },
      { href: '/changelog', label: 'changelog' },
      { href: '/about',     label: 'about' },
    ],
  },
  {
    label: 'use',
    links: [
      { href: '/login',        label: 'web dashboard' },
      { href: '/docs#install', label: 'install cli' },
      { href: '/faq',          label: 'faq' },
      { href: '/pricing',      label: 'pricing' },
    ],
  },
  {
    label: 'source',
    links: [
      { href: 'https://github.com/Tolu-max/JobPilot-Ai',          label: 'github', external: true },
      { href: 'https://github.com/Tolu-max/JobPilot-Ai/issues',   label: 'issues', external: true },
      { href: 'https://github.com/Tolu-max/JobPilot-Ai/blob/main/LICENSE', label: 'mit license', external: true },
    ],
  },
];

const QUICK_CMDS = [
  'npm i -g jobpilot-cli',
  'jobpilot init --profile=me',
  'jobpilot doctor --profile=me',
  'jobpilot run --profile=me --review-first',
];

function FooterCmd({ cmd, delay }) {
  const [copied, setCopied] = useState(false);

  const copy = async (e) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }}
      transition={{ delay, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--line)' }}
    >
      <span style={{ color: 'var(--amber)', fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.82rem', flexShrink: 0 }}>$</span>
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.82rem', color: 'var(--paper-soft)', flex: 1 }}>{cmd}</span>
      <button
        type="button"
        onClick={copy}
        style={{
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize: '0.7rem',
          color: copied ? 'var(--green)' : 'var(--paper-dim)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          transition: 'color 0.15s',
          flexShrink: 0,
        }}
      >
        {copied ? 'copied' : 'copy'}
      </button>
    </motion.div>
  );
}

function NavLink({ href, label, external }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Link
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 0',
        color: hovered ? 'var(--amber)' : 'var(--paper-soft)',
        fontFamily: 'IBM Plex Mono, monospace',
        fontSize: '0.84rem',
        transition: 'color 0.15s',
      }}
    >
      <motion.span
        animate={{ x: hovered ? 4 : 0 }}
        transition={{ duration: 0.15 }}
        style={{ display: 'inline-block' }}
      >
        {label}
      </motion.span>
      {external && (
        <motion.span
          animate={{ opacity: hovered ? 1 : 0, x: hovered ? 0 : -4 }}
          transition={{ duration: 0.15 }}
          style={{ fontSize: '0.72rem', color: 'var(--amber)' }}
        >
          ↗
        </motion.span>
      )}
    </Link>
  );
}

export default function SiteFooter() {
  const footerRef = useRef(null);
  const mouseX = useMotionValue(0.5);
  const mouseY = useMotionValue(0.5);
  const springX = useSpring(mouseX, { stiffness: 60, damping: 20 });
  const springY = useSpring(mouseY, { stiffness: 60, damping: 20 });

  const glowX = useTransform(springX, [0, 1], ['0%', '100%']);
  const glowY = useTransform(springY, [0, 1], ['0%', '60%']);

  const handleMouseMove = (e) => {
    const rect = footerRef.current?.getBoundingClientRect();
    if (!rect) return;
    mouseX.set((e.clientX - rect.left) / rect.width);
    mouseY.set((e.clientY - rect.top) / rect.height);
  };

  return (
    <motion.footer
      ref={footerRef}
      onMouseMove={handleMouseMove}
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6 }}
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderTop: '1px solid var(--line)',
        marginTop: 80,
        background: '#08080c',
      }}
    >
      {/* ambient glow that follows the mouse */}
      <motion.div
        style={{
          position: 'absolute',
          width: 600,
          height: 400,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(251,191,36,0.06) 0%, transparent 70%)',
          pointerEvents: 'none',
          left: glowX,
          top: glowY,
          transform: 'translate(-50%, -50%)',
          zIndex: 0,
        }}
      />

      <div className="container" style={{ position: 'relative', zIndex: 1, padding: '56px 0 36px' }}>

        {/* top section: brand + quick commands */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 56, marginBottom: 48, alignItems: 'start' }}>
          <div>
            <Link href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 9, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, color: 'var(--paper)', marginBottom: 14 }}>
              <span style={{ width: 24, height: 24, display: 'grid', placeItems: 'center', borderRadius: 3, background: 'var(--amber)', color: '#0a0a0a', fontWeight: 700, fontSize: '0.7rem' }}>JP</span>
              jobpilot
            </Link>
            <p style={{ color: 'var(--paper-muted)', fontSize: '0.9rem', lineHeight: 1.65, maxWidth: 310 }}>
              A job-hunt agent for people who would rather audit their tools than trust them. Open source, local by default, MIT.
            </p>

            <div style={{ marginTop: 20, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[
                { href: 'https://github.com/Tolu-max/JobPilot-Ai', label: '★ GitHub' },
                { href: '/security', label: '🔒 Security model' },
              ].map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  target={href.startsWith('http') ? '_blank' : undefined}
                  rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
                  style={{
                    padding: '5px 10px',
                    border: '1px solid var(--line)',
                    borderRadius: 3,
                    color: 'var(--paper-muted)',
                    fontFamily: 'IBM Plex Mono, monospace',
                    fontSize: '0.76rem',
                    transition: 'border-color 0.15s, color 0.15s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--amber)'; e.currentTarget.style.color = 'var(--amber)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.color = 'var(--paper-muted)'; }}
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>

          {/* quick-start command strip */}
          <div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.72rem', color: 'var(--amber)', letterSpacing: '0.06em', marginBottom: 12 }}>
              {'// quick start'}
            </div>
            {QUICK_CMDS.map((cmd, i) => (
              <FooterCmd key={cmd} cmd={cmd} delay={i * 0.07} />
            ))}
            <p style={{ marginTop: 10, color: 'var(--paper-dim)', fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.76rem' }}>
              full guide → <Link href="/docs" style={{ color: 'var(--paper-muted)', textDecoration: 'underline', textDecorationColor: 'var(--line)' }}>jobpilot.dev/docs</Link>
            </p>
          </div>
        </div>

        {/* link columns */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 32, borderTop: '1px solid var(--line)', paddingTop: 32, marginBottom: 32 }}>
          {COLS.map((col, i) => (
            <motion.div
              key={col.label}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08, duration: 0.4 }}
            >
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.72rem', color: 'var(--amber)', letterSpacing: '0.06em', marginBottom: 14 }}>
                {'// '}{col.label}
              </div>
              <div style={{ display: 'grid', gap: 2 }}>
                {col.links.map((link) => (
                  <NavLink key={link.href} {...link} />
                ))}
              </div>
            </motion.div>
          ))}
        </div>

        {/* bottom bar */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          paddingTop: 22,
          borderTop: '1px solid var(--line)',
        }}>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.76rem', color: 'var(--paper-dim)' }}>
            © {new Date().getFullYear()} jobpilot · MIT License
          </span>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.76rem', color: 'var(--paper-dim)', letterSpacing: '0.02em' }}>
            {'// no resumes uploaded · no keys collected · no tracking pixels'}
          </span>
        </div>
      </div>
    </motion.footer>
  );
}
