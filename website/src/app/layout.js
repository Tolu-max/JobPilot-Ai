import Link from 'next/link';
import { Code2, LayoutDashboard } from 'lucide-react';
import './globals.css';

export const metadata = {
  title: 'JobPilot - Open Source Job Automation',
  description: 'A local-first CLI that scrapes, scores, reviews, and applies to jobs with optional hosted dashboard sync.',
};

const navLinks = [
  { href: '/features', label: 'Features' },
  { href: '/docs', label: 'Docs' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/faq', label: 'FAQ' },
  { href: '/changelog', label: 'Changelog' },
  { href: '/about', label: 'About' },
];

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div className="bg-grid" />

        <nav className="glass" style={{ position: 'fixed', top: 0, width: '100%', zIndex: 50 }}>
          <div className="container" style={{ height: '72px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '24px' }}>
            <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 800, fontSize: '1.2rem' }}>
              <span style={{
                width: '32px',
                height: '32px',
                display: 'grid',
                placeItems: 'center',
                borderRadius: '8px',
                background: 'var(--accent)',
                color: '#fff',
                fontSize: '0.95rem'
              }}>
                JP
              </span>
              JobPilot
            </Link>

            <div className="site-nav-list" style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
              {navLinks.map((link) => (
                <Link key={link.href} href={link.href} className="site-nav-link">
                  {link.label}
                </Link>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Link href="/login" className="button button-ghost">
                <LayoutDashboard size={16} /> Dashboard
              </Link>
              <Link href="https://github.com/jobpilot-ai/jobpilot" target="_blank" className="button button-primary">
                <Code2 size={16} /> GitHub
              </Link>
            </div>
          </div>
        </nav>

        <main style={{ paddingTop: '72px', minHeight: '100vh' }}>
          {children}
        </main>

        <footer style={{ borderTop: '1px solid var(--border)', padding: '44px 0', marginTop: '64px' }}>
          <div className="container" style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: '32px' }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: '1.15rem', marginBottom: '10px' }}>JobPilot</div>
              <p className="muted" style={{ maxWidth: '380px', fontSize: '0.95rem' }}>
                Open-source job automation with local secrets, local browser sessions, and optional hosted review dashboards.
              </p>
            </div>
            <div style={{ display: 'grid', gap: '10px' }}>
              <strong>Project</strong>
              <Link href="/features" className="site-nav-link">Features</Link>
              <Link href="/docs" className="site-nav-link">Documentation</Link>
              <Link href="/pricing" className="site-nav-link">Pricing</Link>
              <Link href="/about" className="site-nav-link">About</Link>
            </div>
            <div style={{ display: 'grid', gap: '10px' }}>
              <strong>Operate</strong>
              <Link href="/login" className="site-nav-link">Dashboard</Link>
              <Link href="/faq" className="site-nav-link">FAQ</Link>
              <Link href="/changelog" className="site-nav-link">Changelog</Link>
              <Link href="https://github.com/jobpilot-ai/jobpilot" target="_blank" className="site-nav-link">GitHub</Link>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
