'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { motion } from 'framer-motion';

const STATES = {
  WAITING: { tone: 'amber', label: 'waiting', message: 'Handing your session back to the CLI loopback…' },
  OK:      { tone: 'green', label: 'linked',  message: 'CLI is linked. You can close this tab.' },
  ERROR:   { tone: 'red',   label: 'failed',  message: 'Could not reach the CLI. Is the terminal process still running?' },
  NO_PORT: { tone: 'red',   label: 'failed',  message: 'Missing CLI port. Run `jobpilot login` again from your terminal.' },
  NO_SESSION: { tone: 'red', label: 'failed', message: 'No active session. Sign in first.' },
};

export default function CliAuthPage() {
  const [state, setState] = useState(STATES.WAITING);
  const [meta, setMeta]   = useState({ port: null, email: null });

  useEffect(() => {
    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const port = params.get('port');
      if (!port) { setState(STATES.NO_PORT); return; }

      const supabase = createClient();
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error || !session) { setState(STATES.NO_SESSION); return; }

      const { access_token, refresh_token, user } = session;
      setMeta({ port, email: user.email });

      try {
        const url = `http://localhost:${port}/callback?token=${access_token}&refresh_token=${refresh_token}&email=${encodeURIComponent(user.email)}`;
        const res = await fetch(url);
        setState(res.ok ? STATES.OK : STATES.ERROR);
      } catch {
        setState(STATES.ERROR);
      }
    };
    run();
  }, []);

  const color = state.tone === 'green' ? 'var(--green)' : state.tone === 'red' ? 'var(--red)' : 'var(--amber)';

  return (
    <div style={{ minHeight: 'calc(100vh - 64px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="panel"
        style={{ width: '100%', maxWidth: 540, padding: '36px 32px', display: 'grid', gap: 22 }}
      >
        <div>
          <div className="kicker" style={{ marginBottom: 8 }}>cli handshake</div>
          <h1 className="heading-md">Linking JobPilot CLI</h1>
        </div>

        <div style={{
          border: `1px solid ${color}`,
          borderRadius: 4,
          padding: '20px 22px',
          display: 'grid',
          gap: 10,
          background: state.tone === 'green' ? 'var(--green-soft)' : state.tone === 'red' ? 'var(--red-soft)' : 'var(--amber-glow)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 10, height: 10, borderRadius: '50%', background: color,
              boxShadow: state.tone === 'amber' ? `0 0 12px ${color}` : 'none',
              animation: state.tone === 'amber' ? 'blink 1s steps(1) infinite' : 'none',
            }} />
            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.78rem', textTransform: 'lowercase', letterSpacing: '0.04em', color }}>
              [{state.label}]
            </span>
          </div>
          <p style={{ color: 'var(--paper)', fontSize: '1rem', lineHeight: 1.55 }}>
            {state.message}
          </p>
        </div>

        <hr className="rule" />

        <div style={{ display: 'grid', gap: 8 }}>
          <div className="kicker">handshake details</div>
          <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '8px 14px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.86rem' }}>
            <span className="dim">target</span>     <span style={{ color: 'var(--paper-soft)' }}>http://localhost:{meta.port || '—'}</span>
            <span className="dim">scope</span>      <span style={{ color: 'var(--paper-soft)' }}>dashboard.sync (read+write metadata)</span>
            <span className="dim">account</span>    <span style={{ color: 'var(--paper-soft)' }}>{meta.email || '—'}</span>
            <span className="dim">transport</span>  <span style={{ color: 'var(--paper-soft)' }}>loopback only · 127.0.0.1</span>
          </div>
        </div>

        <p className="dim" style={{ fontSize: '0.82rem', lineHeight: 1.6 }}>
          Revoke any time with <code className="inline-code">jobpilot logout</code> or from <code className="inline-code">/dashboard/settings</code>. The CLI never receives a password — only this short-lived session token.
        </p>
      </motion.div>
    </div>
  );
}
