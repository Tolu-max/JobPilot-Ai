import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import { LockKeyhole, Settings, Terminal } from 'lucide-react';
import ProfileSettingsForm from './ProfileSettingsForm';

export const metadata = { title: 'Settings | JobPilot' };

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const { data: profiles } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', user.id)
    .order('profile_name');

  return (
    <>
      <div className="page-header">
        <span className="page-eyebrow"><Settings size={15} /> Settings</span>
        <h1 className="heading-md">Profile settings</h1>
        <p className="text-body" style={{ fontSize: '0.95rem' }}>
          Edit safe dashboard metadata and profile thresholds. Keep resumes, provider keys, CAPTCHA keys, browser cookies, and job-board credentials in the local CLI environment.
        </p>
      </div>

      <div className="grid-2" style={{ marginBottom: '24px' }}>
        <section className="panel">
          <LockKeyhole size={22} style={{ color: 'var(--green)', marginBottom: 12 }} />
          <h2 className="heading-sm" style={{ marginBottom: 8 }}>Hosted dashboard boundary</h2>
          <p className="muted" style={{ lineHeight: 1.65 }}>
            The web app should store review metadata and safe profile labels only. Sensitive automation files and keys stay local.
          </p>
        </section>
        <section className="panel">
          <Terminal size={22} style={{ color: 'var(--accent-light)', marginBottom: 12 }} />
          <h2 className="heading-sm" style={{ marginBottom: 8 }}>CLI source of truth</h2>
          <p className="muted" style={{ lineHeight: 1.65 }}>
            Run <code>jobpilot init</code>, <code>jobpilot doctor</code>, and <code>jobpilot telegram</code> locally when you need to change private configuration.
          </p>
        </section>
      </div>

      <div style={{ display: 'grid', gap: '18px' }}>
        {(profiles || []).length === 0 ? (
          <section className="panel" style={{ textAlign: 'center' }}>
            <h2 className="heading-sm" style={{ marginBottom: 8 }}>No synced profiles yet</h2>
            <p className="muted">Run <code>jobpilot login</code> and sync a local profile to manage safe metadata here.</p>
          </section>
        ) : (
          profiles.map((profile) => (
            <ProfileSettingsForm key={profile.id} profile={profile} />
          ))
        )}
      </div>
    </>
  );
}
