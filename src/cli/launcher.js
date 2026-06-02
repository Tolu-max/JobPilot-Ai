import pc from 'picocolors';
import { intro, outro, select, isCancel } from '@clack/prompts';
import { readMetrics, formatRelative, formatRelativeFuture } from './metrics.js';

/**
 * `jobpilot` with no args — interactive launcher.
 * Falls back to a one-shot status print on non-TTY (cron, CI, log capture).
 */
export async function cmdLauncher(args = {}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const { cmdSnapshot } = await import('./snapshot.js');
    return cmdSnapshot(args);
  }

  let running = true;
  while (running) {
    console.clear();
    intro(pc.bgCyan(pc.black(' JobPilot ')));
    await printSummaryLine();

    const action = await select({
      message: 'What now?',
      options: [
        { value: 'run',       label: 'Run a job pass',     hint: 'one foreground pass' },
        { value: 'dashboard', label: 'Live dashboard',     hint: 'auto-refreshing view' },
        { value: 'status',    label: 'Status snapshot',    hint: 'one-shot summary' },
        { value: 'review',    label: 'Review queue',       hint: 'approve / reject manually' },
        { value: 'init',      label: 'Settings / new profile', hint: 'wizard' },
        { value: 'doctor',    label: 'Doctor',             hint: 'diagnose install' },
        { value: 'scheduler', label: 'Start scheduler',    hint: 'foreground, long-running' },
        { value: 'exit',      label: pc.dim('Quit') }
      ]
    });

    if (isCancel(action) || action === 'exit') {
      outro(pc.dim('See you when you are ready.'));
      return;
    }

    console.log();
    running = await runAction(action, args);
    if (running) {
      console.log();
      await pause('Press Enter to return to the menu...');
    }
  }
}

async function runAction(action, args) {
  switch (action) {
    case 'run': {
      const { cmdRun } = await import('./runOnce.js');
      await cmdRun(args);
      return true;
    }
    case 'dashboard': {
      const { cmdDashboard } = await import('./dashboard.js');
      await cmdDashboard(args);
      return true;
    }
    case 'status': {
      const { cmdSnapshot } = await import('./snapshot.js');
      await cmdSnapshot(args);
      return true;
    }
    case 'review': {
      const { cmdReview } = await import('./review.js');
      await cmdReview(args);
      return true;
    }
    case 'init': {
      const { interactiveInit } = await import('./onboarding.js');
      await interactiveInit(args);
      return true;
    }
    case 'doctor': {
      const { cmdDoctor } = await import('./doctor.js');
      await cmdDoctor(args);
      return true;
    }
    case 'scheduler': {
      const { cmdSchedulerForeground } = await import('./schedulerCmd.js');
      await cmdSchedulerForeground(args);
      return false; // long-running, never returns
    }
    default:
      return true;
  }
}

async function printSummaryLine() {
  try {
    const m = await readMetrics();
    if (m.totals.profiles === 0) {
      console.log(pc.dim('  No profiles yet — start with "Settings / new profile".'));
      console.log();
      return;
    }
    const now = Date.now();
    console.log(
      pc.dim('  ') +
      `${m.totals.profiles} profile${m.totals.profiles === 1 ? '' : 's'}  ·  ` +
      `last run ${pc.white(formatRelative(m.lastRunAt, now))}  ·  ` +
      `next ${pc.white(formatRelativeFuture(m.nextRunAt, now))}  ·  ` +
      `${pc.green(m.totals.applied24h + ' applied/24h')}  ·  ` +
      `${pc.yellow(m.totals.reviewQueue + ' to review')}`
    );
    console.log();
  } catch { /* skip */ }
}

function pause(message) {
  return new Promise((resolve) => {
    process.stdout.write(pc.dim(`  ${message} `));
    const onData = () => {
      process.stdin.off('data', onData);
      process.stdin.pause();
      resolve();
    };
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}
