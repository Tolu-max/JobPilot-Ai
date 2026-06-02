"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  Globe,
  History,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Settings,
  SlidersHorizontal,
} from 'lucide-react';
import ProfileSelector from './ProfileSelector';

export default function DashboardLayout({ children }) {
  const pathname = usePathname();

  const navItems = [
    { name: 'Overview', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Queue', href: '/dashboard/queue', icon: ListChecks },
    { name: 'Sources', href: '/dashboard/sources', icon: Globe },
    { name: 'Runner', href: '/dashboard/runner', icon: Activity },
    { name: 'History', href: '/dashboard/history', icon: History },
    { name: 'Settings', href: '/dashboard/settings', icon: SlidersHorizontal },
    { name: 'Setup', href: '/dashboard/setup', icon: Settings },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg)' }}>
      <nav className="glass" style={{ borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 100 }}>
        <div className="container" style={{ minHeight: '64px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '18px' }}>
          <div style={{ display: 'flex', gap: '18px', alignItems: 'center', minWidth: 0 }}>
            <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: '9px', fontWeight: 800 }}>
              <span style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', borderRadius: 8, background: 'var(--accent)', color: '#fff', fontSize: '0.82rem' }}>JP</span>
              JobPilot
            </Link>

            <div style={{ display: 'flex', gap: '2px', height: '64px', overflowX: 'auto' }}>
              {navItems.map((item) => {
                const isActive = pathname === item.href;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={`dashboard-nav-link ${isActive ? 'dashboard-nav-link-active' : ''}`}
                  >
                    <Icon size={16} />
                    {item.name}
                  </Link>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
            <ProfileSelector />
            <form action="/auth/logout" method="post">
              <button className="button button-ghost" title="Sign out">
                <LogOut size={16} /> Sign Out
              </button>
            </form>
          </div>
        </div>
      </nav>

      <main style={{ flex: 1 }}>
        <div className="container" style={{ padding: '34px 0 54px', animation: 'fadeUp 0.28s ease-out' }}>
          {children}
        </div>
      </main>
    </div>
  );
}
