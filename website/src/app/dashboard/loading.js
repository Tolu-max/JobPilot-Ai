export default function DashboardLoading() {
  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '40px 24px', animation: 'fadeIn 0.3s ease-out' }}>
      
      {/* Header Skeleton */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' }}>
        <div>
          <div className="skeleton" style={{ width: '300px', height: '40px', borderRadius: '8px', marginBottom: '12px' }} />
          <div className="skeleton" style={{ width: '450px', height: '20px', borderRadius: '6px' }} />
        </div>
        <div className="skeleton" style={{ width: '120px', height: '40px', borderRadius: '8px' }} />
      </div>

      {/* Stats Skeleton */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '40px' }}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="glass-card" style={{ padding: '24px', opacity: 0.7 }}>
            <div className="skeleton" style={{ width: '150px', height: '16px', borderRadius: '4px', marginBottom: '16px' }} />
            <div className="skeleton" style={{ width: '80px', height: '48px', borderRadius: '8px' }} />
          </div>
        ))}
      </div>

      {/* Table Skeleton */}
      <div className="glass-card" style={{ padding: '32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div className="skeleton" style={{ width: '200px', height: '28px', borderRadius: '6px' }} />
          <div className="skeleton" style={{ width: '100px', height: '28px', borderRadius: '6px' }} />
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} style={{ display: 'flex', gap: '16px', borderBottom: '1px solid var(--border)', paddingBottom: '16px' }}>
              <div className="skeleton" style={{ width: '30%', height: '24px', borderRadius: '4px' }} />
              <div className="skeleton" style={{ width: '25%', height: '24px', borderRadius: '4px' }} />
              <div className="skeleton" style={{ width: '20%', height: '24px', borderRadius: '4px' }} />
              <div className="skeleton" style={{ width: '25%', height: '24px', borderRadius: '4px' }} />
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .skeleton {
          background: linear-gradient(90deg, var(--border) 25%, var(--border-light) 50%, var(--border) 75%);
          background-size: 200% 100%;
          animation: shimmer 1.5s infinite;
        }
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
