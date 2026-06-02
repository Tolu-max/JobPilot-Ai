'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { motion } from 'framer-motion'

export default function CliAuthPage() {
  const [status, setStatus] = useState('Authenticating CLI...')
  
  useEffect(() => {
    const runHandshake = async () => {
      const params = new URLSearchParams(window.location.search)
      const port = params.get('port')

      if (!port) {
        setStatus('Error: Missing CLI port parameter.')
        return
      }

      const supabase = createClient()
      const { data: { session }, error } = await supabase.auth.getSession()

      if (error || !session) {
        setStatus('Error: No active session found. Please log in first.')
        return
      }

      // We have the session. Pass the access_token and refresh_token to the CLI's local server.
      const { access_token, refresh_token, user } = session

      try {
        const response = await fetch(`http://localhost:${port}/callback?token=${access_token}&refresh_token=${refresh_token}&email=${encodeURIComponent(user.email)}`)
        if (response.ok) {
          setStatus('Authentication successful! You can close this tab and return to your terminal.')
        } else {
          setStatus('Error: Could not reach the CLI local server. Is it still running?')
        }
      } catch (err) {
        setStatus('Error: Could not connect to localhost CLI. Is the terminal process running?')
      }
    }

    runHandshake()
  }, [])

  return (
    <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="glass-card"
        style={{ padding: '60px 40px', width: '100%', maxWidth: '500px', textAlign: 'center' }}
      >
        <h1 className="heading-md" style={{ marginBottom: '24px' }}>CLI Authentication</h1>
        
        <div style={{ 
          padding: '24px', 
          background: status.includes('successful') ? 'rgba(16, 185, 129, 0.1)' : status.includes('Error') ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255,255,255,0.05)', 
          border: '1px solid',
          borderColor: status.includes('successful') ? 'rgba(16, 185, 129, 0.3)' : status.includes('Error') ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255,255,255,0.1)',
          borderRadius: '12px',
          color: status.includes('successful') ? 'var(--green)' : status.includes('Error') ? '#ef4444' : 'var(--text-main)',
          fontSize: '1.1rem'
        }}>
          {status}
        </div>
      </motion.div>
    </div>
  )
}
