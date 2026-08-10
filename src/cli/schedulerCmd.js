import pc from 'picocolors';

/**
 * `jobpilot scheduler` — foreground scheduler runner.
 * The standard long-running entry point for Docker / Railway / Render.
 * No PM2, no background daemons; logs go to stdout so the host can capture them.
 */
export async function cmdSchedulerForeground(args = {}) {
  process.on('beforeExit', (code) => {
    process.stderr.write(`[scheduler] beforeExit code=${code}\n`);
  });
  process.on('exit', (code) => {
    process.stderr.write(`[scheduler] exit code=${code}\n`);
  });

  // PROFILES (plural, comma-separated) takes priority over single PROFILE.
  const profiles = process.env.PROFILES || args.profiles;
  const profile = args.profile || args.p || process.env.PROFILE;

  if (profiles) {
    process.argv.push(`--profiles=${profiles}`);
  } else if (profile) {
    process.argv.push(`--profile=${profile}`);
  }

  const displayProfiles = profiles || profile || '';
  process.stdout.write(pc.bold(pc.cyan('  JobPilot scheduler')) + pc.dim(` · pid ${process.pid}`) + '\n');
  process.stdout.write(pc.dim(`  interval: ${process.env.SCHEDULER_INTERVAL_MS || 14400000} ms`) + '\n');
  if (displayProfiles) process.stdout.write(pc.dim(`  profiles: `) + pc.cyan(displayProfiles) + '\n');
  process.stdout.write('\n');

  const { startScheduler } = await import('../scheduler.js');

  const shutdown = (signal) => {
    process.stderr.write(`[scheduler] received ${signal}\n`);
    process.stdout.write('\n' + pc.dim(`  received ${signal}, exiting...`) + '\n');
    process.exit(0);
  };
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await startScheduler(process.argv);
    // Keep an explicit foreground handle alive for Railway/background workers.
    // The scheduler also owns its timers, but this prevents host lifecycle
    // behavior from treating a completed startup promise as a finished job.
    const keepAlive = setInterval(() => {}, 60 * 60 * 1000);
    process.stdin.resume();
    process.once('exit', () => clearInterval(keepAlive));
    await new Promise(() => {});
  } catch (err) {
    process.stderr.write('\n' + pc.red(`  Scheduler crashed: ${err.message}`) + '\n');
    process.stderr.write(pc.dim(err.stack || '') + '\n');
    process.exit(1);
  }
}
