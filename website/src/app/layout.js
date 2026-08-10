import Link from 'next/link';
import SiteFooter from '@/components/SiteFooter';
import './globals.css';

export const metadata = {
  title: 'JobPilot — A local-first job hunt agent',
  description: 'Open-source CLI that scrapes, scores, and applies to remote jobs from your own machine. Optional web dashboard for review. Your resumes, keys, and browser sessions never leave your laptop.',
};

const navLinks = [
  { href: '/features',  label: 'Features' },
  { href: '/docs',      label: 'Docs' },
  { href: '/security',  label: 'Security' },
  { href: '/pricing',   label: 'Pricing' },
  { href: '/faq',       label: 'FAQ' },
  { href: '/changelog', label: 'Changelog' },
];

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div className="bg-grid" />

        <nav className="glass" style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50, borderBottom: '1px solid var(--line)' }}>
          <div className="container" style={{ height: '64px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '20px' }}>
            <Link href="/" className="brand" aria-label="JobPilot home">
              <span className="brand-mark">JP</span>
              <span>jobpilot</span>
              <span className="brand-tag">v1.0</span>
            </Link>

            <div className="site-nav-list" style={{ display: 'flex', alignItems: 'center', gap: '22px' }}>
              {navLinks.map((link) => (
                <Link key={link.href} href={link.href} className="site-nav-link">
                  {link.label}
                </Link>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Link href="/login" className="button button-ghost">Dashboard</Link>
              <Link
                href="https://github.com/Tolu-max/JobPilot-Ai"
                target="_blank"
                rel="noopener noreferrer"
                className="button button-primary"
              >
                GitHub →
              </Link>
            </div>
          </div>
        </nav>

        <main style={{ paddingTop: '64px', minHeight: '100vh' }}>
          {children}
        </main>

        <SiteFooter />
      </body>
    </html>
  );
}
