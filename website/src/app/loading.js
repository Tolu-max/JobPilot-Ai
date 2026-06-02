import { Loader2 } from 'lucide-react';

export default function Loading() {
  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'center', 
      height: '100vh',
      width: '100vw',
      background: 'var(--bg)',
      position: 'fixed',
      top: 0,
      left: 0,
      zIndex: 9999
    }}>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          position: 'absolute',
          width: '80px',
          height: '80px',
          borderRadius: '50%',
          background: 'rgba(79, 140, 255, 0.18)',
          filter: 'blur(20px)',
          animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
        }} />
        <Loader2 size={48} color="var(--accent-light)" style={{ animation: 'spin 1s linear infinite', position: 'relative', zIndex: 1 }} />
      </div>
      <h2 style={{ marginTop: '24px', color: 'var(--text-main)', fontSize: '1.2rem', fontWeight: 600, letterSpacing: 0 }}>
        Loading JobPilot...
      </h2>
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: .5; transform: scale(1.2); }
        }
      `}</style>
    </div>
  );
}
