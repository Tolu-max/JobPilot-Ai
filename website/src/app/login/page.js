'use client'
import { useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { motion } from 'framer-motion'

export default function LoginPage() {
  const supabase = createClient()
  const [cliPort] = useState(() => {
    if (typeof window === 'undefined') return null
    return new URLSearchParams(window.location.search).get('cli_port')
  })

  const handleOAuthLogin = async (provider) => {
    await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback${cliPort ? `?next=/cli-auth?port=${cliPort}` : ''}`,
      },
    })
  }

  return (
    <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      
      <motion.div 
        initial={{ opacity: 0, y: 20 }} 
        animate={{ opacity: 1, y: 0 }} 
        transition={{ duration: 0.5 }}
        className="glass-card" 
        style={{ padding: '60px 40px', width: '100%', maxWidth: '440px', textAlign: 'center' }}
      >
        <h1 className="heading-md" style={{ marginBottom: '12px' }}>Welcome Back</h1>
        <p className="text-body" style={{ marginBottom: '40px', fontSize: '0.95rem' }}>
          Sign in to access your live job dashboard.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <button 
            onClick={() => handleOAuthLogin('github')}
            style={{ 
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px',
              width: '100%', padding: '16px', borderRadius: '12px',
              background: '#24292e', color: '#fff', fontSize: '1rem', fontWeight: 600,
              border: '1px solid rgba(255,255,255,0.1)', transition: 'all 0.2s', cursor: 'pointer'
            }}
            onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
            onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg> 
            Continue with GitHub
          </button>

          <button 
            onClick={() => handleOAuthLogin('google')}
            style={{ 
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px',
              width: '100%', padding: '16px', borderRadius: '12px',
              background: '#fff', color: '#000', fontSize: '1rem', fontWeight: 600,
              border: '1px solid transparent', transition: 'all 0.2s', cursor: 'pointer'
            }}
            onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
            onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="#ea4335" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"></rect><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path></svg> 
            Continue with Google
          </button>
        </div>

        <p style={{ marginTop: '32px', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
          By continuing, you agree to JobPilot&apos;s Open Source terms.
        </p>
      </motion.div>

    </div>
  )
}
