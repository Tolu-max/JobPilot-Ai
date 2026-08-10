'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const PIE_COLORS = ['#7c4dff', '#4dffb0', '#4dd9ff', '#b89cff', '#ff5f7e', '#ffc94d'];

const TOOLTIP_STYLE = {
  contentStyle: {
    background: '#10101a',
    border: '1px solid rgba(124,77,255,0.3)',
    borderRadius: 4,
    color: 'var(--paper)',
    fontFamily: 'IBM Plex Mono, monospace',
    fontSize: '0.8rem',
  },
  itemStyle: { color: 'var(--paper)' },
  cursor: { fill: 'rgba(124,77,255,0.06)' },
};

const Panel = ({ children, title }) => (
  <div style={{
    background: 'var(--surface)',
    border: '1px solid var(--line)',
    borderRadius: 4,
    padding: '20px 22px',
    transition: 'border-color 0.18s',
  }}
    onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--line-violet)'; }}
    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--line)'; }}
  >
    <h3 style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.86rem', fontWeight: 600, marginBottom: 18, color: 'var(--paper-soft)', letterSpacing: '-0.01em' }}>
      {title}
    </h3>
    {children}
  </div>
);

export default function AnalyticsCharts({ jobs }) {
  if (!jobs?.length) return null;

  const scoreBuckets = { '≥90': 0, '80–89': 0, '70–79': 0, '<70': 0 };
  const platforms    = {};

  jobs.forEach((job) => {
    const s = Number(job.score || 0);
    if (s >= 90) scoreBuckets['≥90']++;
    else if (s >= 80) scoreBuckets['80–89']++;
    else if (s >= 70) scoreBuckets['70–79']++;
    else scoreBuckets['<70']++;

    const p = job.source_site || 'unknown';
    platforms[p] = (platforms[p] || 0) + 1;
  });

  const scoreData = Object.entries(scoreBuckets).map(([name, count]) => ({ name, count }));
  const pieData   = Object.entries(platforms).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 18, marginBottom: 22 }}>
      <Panel title="// score distribution">
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={scoreData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <XAxis dataKey="name" stroke="var(--paper-dim)" fontSize={11} tickLine={false} axisLine={false} fontFamily="IBM Plex Mono, monospace" />
              <YAxis stroke="var(--paper-dim)" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Bar dataKey="count" fill="var(--violet)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Panel title="// sources breakdown">
        <div style={{ height: 160 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={68} paddingAngle={4} dataKey="value" stroke="none">
                {pieData.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip {...TOOLTIP_STYLE} cursor={false} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', marginTop: 10 }}>
          {pieData.slice(0, 5).map((entry, i) => (
            <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'IBM Plex Mono,monospace', fontSize: '0.74rem', color: 'var(--paper-muted)' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: PIE_COLORS[i % PIE_COLORS.length], display: 'inline-block', flexShrink: 0 }} />
              {entry.name}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
