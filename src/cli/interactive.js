import { intro, outro, select, text, isCancel, note } from '@clack/prompts';
import pc from 'picocolors';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { cmdStart, cmdStop, cmdStatus, cmdLogs } from './commands.js';
import { cmdDashboard as cmdTerminalDashboard } from './dashboard.js';
import { interactiveInit } from './onboarding.js';
import { interactiveChat } from './chat.js';

const ROOT = process.cwd();

export async function cmdInteractive(args) {
  console.clear();
  intro(pc.bgCyan(pc.black(' JobPilot Dashboard ')));

  let running = true;
  while (running) {
    await printHome(args);

    const action = await select({
      message: 'What would you like to do?',
      options: [
        { value: 'hunt', label: 'Start job hunt', hint: 'Run the scheduler in the background' },
        { value: 'applications', label: 'View applications', hint: 'Show profile pipeline status' },
        { value: 'cv', label: 'Review CV intelligence', hint: 'Open profile/CV setup flow' },
        { value: 'chat', label: 'AI Assistant', hint: 'Ask about jobs, CV, matches, and rejections' },
        { value: 'dashboard', label: 'Open terminal dashboard', hint: 'Local auto-refreshing view' },
        { value: 'settings', label: 'System status', hint: 'Scheduler and profile health' },
        { value: 'natural', label: 'Type a request', hint: 'Example: find remote jobs for me' },
        { value: 'exit', label: 'Exit' }
      ]
    });

    if (isCancel(action) || action === 'exit') {
      outro(pc.gray('JobPilot is ready when you are.'));
      process.exit(0);
    }

    switch (action) {
      case 'hunt':
        await cmdStart(args);
        break;
      case 'applications':
      case 'settings':
        await cmdStatus(args);
        break;
      case 'cv':
        await interactiveInit(args);
        break;
      case 'chat':
        await interactiveChat(args);
        break;
      case 'dashboard':
        await cmdTerminalDashboard(args);
        break;
      case 'natural':
        await handleNaturalRequest(args);
        break;
    }

    console.log();
  }
}

async function printHome(args) {
  const summary = await buildSummary(args);
  const cols = process.stdout.columns || 80;

  if (cols < 72) {
    note([
      `Scheduler: ${summary.schedulerRunning ? 'running' : 'stopped'}`,
      `Profiles: ${summary.profileCount}`,
      `Applied today: ${summary.today.applied}`,
      `Review queue: ${summary.reviewQueue}`,
      `Failures: ${summary.failed}`
    ].join('\n'), 'Status');
    return;
  }

  console.log(pc.bold('Welcome back'));
  console.log();
  console.log(pc.bold('STATUS'));
  console.log(`  Scheduler running : ${summary.schedulerRunning ? pc.green('yes') : pc.red('no')}`);
  console.log(`  Profiles active   : ${summary.profileCount}`);
  console.log(`  Last activity     : ${summary.lastActivity || 'none yet'}`);
  console.log();
  console.log(pc.bold('TODAY'));
  console.log(`  Jobs found        : ${summary.today.total}`);
  console.log(`  Applied           : ${summary.today.applied}`);
  console.log(`  Review queue      : ${summary.reviewQueue}`);
  console.log(`  Failures          : ${summary.failed}`);
  console.log();
}

async function handleNaturalRequest(args) {
  const request = await text({
    message: 'Tell JobPilot what you want:',
    placeholder: 'find remote jobs for me'
  });

  if (isCancel(request) || !String(request).trim()) return;
  const normalized = String(request).toLowerCase();

  if (/find|hunt|apply|remote jobs|start/.test(normalized)) {
    await cmdStart(args);
    return;
  }

  if (/why|selected|rejected|rejection|cv|resume|improve|update/.test(normalized)) {
    await interactiveChat({ ...args, _: request });
    return;
  }

  if (/status|running|failure|failed|queue|applications/.test(normalized)) {
    await cmdStatus(args);
    return;
  }

  note('I will open AI Assistant for that request.', 'Routing');
  await interactiveChat({ ...args, _: request });
}

async function buildSummary() {
  const profilesDir = path.join(ROOT, 'profiles');
  let profiles = [];
  try {
    profiles = (await fs.readdir(profilesDir)).filter((p) => !p.startsWith('.') && p !== 'example');
  } catch {
    profiles = [];
  }

  const summary = {
    schedulerRunning: isSchedulerRunning(),
    profileCount: profiles.length,
    reviewQueue: 0,
    failed: 0,
    lastActivity: '',
    today: { total: 0, applied: 0 }
  };

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let latest = 0;

  for (const profile of profiles) {
    try {
      const store = JSON.parse(await fs.readFile(path.join(profilesDir, profile, 'processedJobs.json'), 'utf8'));
      for (const job of store.jobs || []) {
        const updated = job.updatedAt ? new Date(job.updatedAt).getTime() : 0;
        if (updated > latest) latest = updated;
        if (updated >= cutoff) {
          summary.today.total += 1;
          if (job.status === 'applied') summary.today.applied += 1;
        }
        if (job.status === 'reviewed' || job.status === 'pending_apply') summary.reviewQueue += 1;
        if (job.status === 'failed') summary.failed += 1;
      }
    } catch {
      // Profile may not have run yet.
    }
  }

  summary.lastActivity = latest ? new Date(latest).toLocaleString() : '';
  return summary;
}

function isSchedulerRunning() {
  try {
    const output = execSync('npx pm2 jlist', { encoding: 'utf8', cwd: ROOT, windowsHide: true });
    const apps = JSON.parse(output);
    return apps.some((app) => app.name === 'jobpilot-scheduler' && app.pm2_env?.status === 'online');
  } catch {
    return false;
  }
}
