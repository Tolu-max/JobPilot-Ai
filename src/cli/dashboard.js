import React, { useState, useEffect, useMemo } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import { spawn } from 'node:child_process';
import { readMetrics, readAiSpend, formatRelative, formatRelativeFuture } from './metrics.js';

const h = React.createElement;
const REFRESH_MS = 5000;

const STATUS_COLOR = {
  applied:        'green',
  reviewed:       'yellow',
  pending_apply:  'yellow',
  manual_review:  'yellow',
  failed:         'red',
  ignored:        'gray'
};

const STATUS_GLYPH = {
  applied:        '✓',
  reviewed:       '⏵',
  pending_apply:  '⏵',
  manual_review:  '⏵',
  failed:         '✗',
  ignored:        '·'
};

function Dashboard({ initialMetrics, initialAi }) {
  const { exit } = useApp();
  const [metrics, setMetrics] = useState(initialMetrics);
  const [ai, setAi]           = useState(initialAi);
  const [now, setNow]         = useState(Date.now());
  const [banner, setBanner]   = useState(null);

  useEffect(() => {
    const tick = setInterval(async () => {
      try {
        const [m, a] = await Promise.all([readMetrics(), readAiSpend()]);
        setMetrics(m);
        setAi(a);
        setNow(Date.now());
      } catch (err) {
        setBanner({ kind: 'error', text: err.message });
      }
    }, REFRESH_MS);
    return () => clearInterval(tick);
  }, []);

  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
      return;
    }
    if (input === 'r') {
      setBanner({ kind: 'info', text: 'Starting a run in a new window — leave this dashboard open to watch it.' });
      try {
        const proc = spawn(process.execPath, ['cli.js', 'run'], {
          cwd: process.cwd(),
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        });
        proc.unref();
      } catch (err) {
        setBanner({ kind: 'error', text: `Could not start run: ${err.message}` });
      }
    }
    if (input === 'v') {
      setBanner({ kind: 'info', text: 'Open a new terminal and run:  jobpilot review' });
    }
  });

  const profiles = metrics.perProfile.map((p) => p.name).join(' · ') || '(no profiles)';

  return h(Box, { flexDirection: 'column', paddingX: 1 },
    h(Box, { borderStyle: 'round', borderColor: 'cyan', flexDirection: 'column', paddingX: 1 },
      h(Box, { justifyContent: 'space-between' },
        h(Text, { bold: true, color: 'cyan' }, 'JobPilot'),
        h(Text, { dimColor: true }, profiles)
      ),

      h(Box, { marginTop: 1, flexDirection: 'column' },
        h(StatRow, { label: 'Last run',    value: formatRelative(metrics.lastRunAt, now) }),
        h(StatRow, { label: 'Next run',    value: formatRelativeFuture(metrics.nextRunAt, now) }),
        h(StatRow, { label: 'Applies/24h', value: String(metrics.totals.applied24h), color: 'green' }),
        h(StatRow, { label: 'Reviewed',    value: String(metrics.totals.reviewQueue), color: 'yellow' }),
        h(StatRow, { label: 'Failures',    value: String(metrics.totals.failed24h),  color: metrics.totals.failed24h ? 'red' : undefined }),
        ai && h(StatRow, { label: 'AI calls',    value: `${ai.calls}  (~$${ai.estimatedUsd})` })
      ),

      h(Box, { marginTop: 1, flexDirection: 'column' },
        h(Text, { bold: true }, 'By profile'),
        ...metrics.perProfile.map((p) => h(ProfileRow, { key: p.name, p }))
      ),

      h(Box, { marginTop: 1, flexDirection: 'column' },
        h(Text, { bold: true }, 'Recent activity'),
        metrics.recentActivity.length === 0
          ? h(Text, { dimColor: true }, '  (no activity yet)')
          : null,
        ...metrics.recentActivity.slice(0, 8).map((a, i) => h(ActivityRow, { key: i, a }))
      ),

      banner && h(Box, { marginTop: 1 },
        h(Text, { color: banner.kind === 'error' ? 'red' : 'cyan' }, banner.text)
      ),

      h(Box, { marginTop: 1, justifyContent: 'space-between' },
        h(Text, { dimColor: true }, '[r] run now   [v] review   [q] quit'),
        h(Text, { dimColor: true }, `refreshes every ${REFRESH_MS / 1000}s`)
      )
    )
  );
}

function StatRow({ label, value, color }) {
  return h(Box, null,
    h(Text, { dimColor: true }, label.padEnd(12)),
    h(Text, { color }, value)
  );
}

function ProfileRow({ p }) {
  return h(Box, null,
    h(Text, null, '  ' + p.name.padEnd(10)),
    h(Text, { color: 'green' }, String(p.applied24h).padStart(2) + ' applied/24h'),
    h(Text, null, '  '),
    h(Text, { color: 'yellow' }, String(p.reviewQueue).padStart(2) + ' queued'),
    h(Text, null, '  '),
    h(Text, { dimColor: true }, String(p.appliedAllTime) + ' all-time'),
    h(Text, null, '  '),
    h(Text, { color: p.autoApply ? 'green' : 'gray' }, p.autoApply ? 'auto' : 'manual')
  );
}

function ActivityRow({ a }) {
  const color = STATUS_COLOR[a.status] || 'gray';
  const glyph = STATUS_GLYPH[a.status] || '·';
  const title = a.title.length > 38 ? a.title.slice(0, 37) + '…' : a.title;
  return h(Box, null,
    h(Text, { color }, '  ' + glyph + ' '),
    h(Text, { dimColor: true }, a.time + ' '),
    h(Text, { color: 'cyan' }, (a.profile || '').padEnd(8) + ' '),
    h(Text, { dimColor: true }, (a.site || '').padEnd(10) + ' '),
    h(Text, null, title)
  );
}

export async function cmdDashboard(args = {}) {
  if (!process.stdout.isTTY) {
    const { cmdSnapshot } = await import('./snapshot.js');
    return cmdSnapshot(args);
  }
  const [m, a] = await Promise.all([readMetrics(), readAiSpend()]);
  render(h(Dashboard, { initialMetrics: m, initialAi: a }));
}
