'use client';

import { useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { motion } from 'framer-motion';

export default function LoginPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(null);
  const [cliPort] = useState(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('cli_port');
  });

  const handleOAuth = async (provider) => {
    setLoading(provider);
    await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback${cliPort ? `?next=/cli-auth?port=${cliPort}` : ''}`,
      },
    });
  };

  return (
    <div style={{ minHeight: 'calc(100vh - 64px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 20px' }}>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="panel"
        style={{ width: '100%', maxWidth: 440, padding: '40px 36px', display: 'grid', gap: 22 }}
      >
        <div>
          <div className="kicker" style={{ marginBottom: 8 }}>sign in</div>
          <h1 className="heading-md" style={{ marginBottom: 8 }}>
            {cliPort ? 'Linking the CLI' : 'Open the dashboard'}
          </h1>
          <p className="muted" style={{ fontSize: '0.95rem', lineHeight: 1.6 }}>
            {cliPort
              ? `Sign in to hand a session back to your local CLI on port ${cliPort}. You'll never paste a token.`
              : 'Approve queued roles, review history, and see source health across devices. No resume, no keys — metadata only.'}
          </p>
        </div>

        <div style={{ display: 'grid', gap: 10 }}>
          <button
            type="button"
            onClick={() => handleOAuth('github')}
            disabled={loading !== null}
            className="button"
            style={{
              minHeight: 48,
              justifyContent: 'flex-start',
              padding: '0 16px',
              gap: 12,
              background: '#161616',
              borderColor: 'var(--line-strong)',
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.27-.01-1.16-.02-2.1-3.2.7-3.88-1.36-3.88-1.36-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.75 1.18 1.75 1.18 1.02 1.75 2.68 1.24 3.34.95.1-.74.4-1.24.72-1.53-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.18 1.18.92-.26 1.91-.39 2.9-.39.98 0 1.97.13 2.9.39 2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.26 5.68.41.35.77 1.05.77 2.12 0 1.53-.01 2.76-.01 3.13 0 .31.21.68.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"/></svg>
            <span style={{ flex: 1, textAlign: 'left' }}>{loading === 'github' ? 'Opening GitHub…' : 'Continue with GitHub'}</span>
            <span style={{ color: 'var(--paper-dim)' }}>→</span>
          </button>

          <button
            type="button"
            onClick={() => handleOAuth('google')}
            disabled={loading !== null}
            className="button"
            style={{
              minHeight: 48,
              justifyContent: 'flex-start',
              padding: '0 16px',
              gap: 12,
              background: '#f5f5f0',
              color: '#0a0a0a',
              borderColor: '#f5f5f0',
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A10.99 10.99 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18A10.99 10.99 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/></svg>
            <span style={{ flex: 1, textAlign: 'left' }}>{loading === 'google' ? 'Opening Google…' : 'Continue with Google'}</span>
            <span style={{ color: 'rgba(0,0,0,0.4)' }}>→</span>
          </button>
        </div>

        <hr className="rule" />

        <div style={{ display: 'grid', gap: 6 }}>
          <span className="kicker">what you&apos;re agreeing to</span>
          <p className="dim" style={{ fontSize: '0.82rem', lineHeight: 1.6 }}>
            We store your email and a profile id. Approvals you make here are pulled by your local CLI on its next tick. We never receive your resume, AI keys, browser cookies, or job-board passwords. MIT-licensed; see the GitHub repo.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
