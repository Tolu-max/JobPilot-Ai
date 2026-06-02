'use client';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

export default function AnalyticsCharts({ jobs }) {
  if (!jobs || jobs.length === 0) return null;

  // Process data for Score Distribution
  const scoreRanges = {
    '90-100': 0,
    '80-89': 0,
    '70-79': 0,
    '<70': 0
  };

  const platforms = {};

  jobs.forEach(job => {
    // Scores
    if (job.score >= 90) scoreRanges['90-100']++;
    else if (job.score >= 80) scoreRanges['80-89']++;
    else if (job.score >= 70) scoreRanges['70-79']++;
    else scoreRanges['<70']++;

    // Platforms
    const p = job.source_site || 'Unknown';
    platforms[p] = (platforms[p] || 0) + 1;
  });

  const scoreData = Object.keys(scoreRanges).map(key => ({
    name: key,
    count: scoreRanges[key]
  }));

  const platformData = Object.keys(platforms).map(key => ({
    name: key,
    value: platforms[key]
  })).sort((a, b) => b.value - a.value);

  const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#64748b'];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px', marginBottom: '40px' }}>
      
      {/* Score Distribution Chart */}
      <div className="glass-card" style={{ padding: '24px' }}>
        <h3 className="heading-md" style={{ fontSize: '1.1rem', marginBottom: '20px' }}>AI Match Scores</h3>
        <div style={{ height: '250px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={scoreData}>
              <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip 
                cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff' }}
                itemStyle={{ color: '#10b981' }}
              />
              <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Platform Efficiency Chart */}
      <div className="glass-card" style={{ padding: '24px' }}>
        <h3 className="heading-md" style={{ fontSize: '1.1rem', marginBottom: '20px' }}>Sourcing Platforms</h3>
        <div style={{ height: '250px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={platformData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                paddingAngle={5}
                dataKey="value"
                stroke="none"
              >
                {platformData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip 
                contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff' }}
                itemStyle={{ color: '#fff' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        
        {/* Custom Legend for Pie Chart */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'center', marginTop: '16px' }}>
          {platformData.slice(0, 4).map((entry, index) => (
            <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: COLORS[index % COLORS.length] }}></div>
              {entry.name}
            </div>
          ))}
        </div>
      </div>
      
    </div>
  );
}
