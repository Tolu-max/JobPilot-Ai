"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity, Globe, History, LayoutDashboard,
  ListChecks, LogOut, Settings, SlidersHorizontal,
} from 'lucide-react';
import ProfileSelector from './ProfileSelector';

const NAV = [
  { name: 'Overview',  href: '/dashboard',          icon: LayoutDashboard },
  { name: 'Queue',     href: '/dashboard/queue',     icon: ListChecks },
  { name: 'Sources',   href: '/dashboard/sources',   icon: Globe },
  { name: 'Runner',    href: '/dashboard/runner',    icon: Activity },
  { name: 'History',   href: '/dashboard/history',   icon: History },
  { name: 'Settings',  href: '/dashboard/settings',  icon: SlidersHorizontal },
  { name: 'Setup',     href: '/dashboard/setup',     icon: Settings },
];

export default function DashboardLayout({ children }) {
  const pathname = usePathname();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg)' }}>

      {/* top bar */}
      <nav style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        background: 'rgba(5,5,10,0.88)',
        backdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--line)',
      }}>
        <div className="container" style={{ height: 58, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
          {/* brand + nav tabs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 0, flex: 1, minWidth: 0, overflow: 'hidden' }}>
            <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'IBM Plex Mono,monospace', fontWeight: 600, fontSize: '0.95rem', marginRight: 24, flexShrink: 0, color: 'var(--paper)' }}>
              <span style={{ width: 24, height: 24, display: 'grid', placeItems: 'center', borderRadius: 3, background: 'var(--violet)', color: '#fff', fontSize: '0.65rem', fontWeight: 700, boxShadow: '0 0 10px rgba(124,77,255,0.5)', flexShrink: 0 }}>JP</span>
              jobpilot
            </Link>

            <div style={{ display: 'flex', height: 58, overflowX: 'auto', gap: 0 }}>
              {NAV.map(({ name, href, icon: Icon }) => {
                const active = pathname === href;
                return (
                  <Link
                    key={name}
                    href={href}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '0 14px',
                      height: '100%',
                      borderBottom: `2px solid ${active ? 'var(--violet)' : 'transparent'}`,
                      color: active ? 'var(--violet-pale)' : 'var(--paper-muted)',
                      fontFamily: 'IBM Plex Sans,sans-serif',
                      fontWeight: 500,
                      fontSize: '0.86rem',
                      whiteSpace: 'nowrap',
                      transition: 'color 0.14s, border-color 0.14s',
                    }}
                    onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = 'var(--paper)'; }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = 'var(--paper-muted)'; }}
                  >
                    <Icon size={14} />
                    {name}
                  </Link>
                );
              })}
            </div>
          </div>

          {/* right: profile selector + sign out */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <ProfileSelector />
            <form action="/auth/logout" method="post">
              <button
                className="button button-ghost"
                style={{ minHeight: 34, padding: '6px 10px', fontSize: '0.84rem', gap: 6 }}
                title="Sign out"
              >
                <LogOut size={14} />
                <span style={{ display: 'none', '--show-at': '640px' }}>Sign out</span>
              </button>
            </form>
          </div>
        </div>
      </nav>

      {/* page content */}
      <main style={{ flex: 1 }}>
        <div className="container" style={{ padding: '32px 0 64px', animation: 'fadeUp 0.28s ease-out' }}>
          {children}
        </div>
      </main>

      {/* dashboard mini-footer */}
      <div style={{ borderTop: '1px solid var(--line)', padding: '14px 0' }}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <span style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: '0.72rem', color: 'var(--paper-dim)' }}>
            jobpilot dashboard — metadata only, no secrets stored
          </span>
          <Link href="/" style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: '0.72rem', color: 'var(--paper-dim)', transition: 'color 0.14s' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--violet-light)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--paper-dim)'; }}
          >
            ← back to site
          </Link>
        </div>
      </div>
    </div>
  );
}
