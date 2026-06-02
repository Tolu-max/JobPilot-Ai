import pc from 'picocolors';

/**
 * `jobpilot scheduler` — foreground scheduler runner.
 * The standard long-running entry point for Docker / Railway / Render.
 * No PM2, no background daemons; logs go to stdout so the host can capture them.
 */
export async function cmdSchedulerForeground(args = {}) {
  const profile = args.profile || args.p || process.env.PROFILE;
  if (profile) {
    process.argv.push(`--profile=${profile}`);
  }

  process.stdout.write(pc.bold(pc.cyan('  JobPilot scheduler')) + pc.dim(` · pid ${process.pid}`) + '\n');
  process.stdout.write(pc.dim(`  interval: ${process.env.SCHEDULER_INTERVAL_MS || 14400000} ms`) + '\n');
  if (profile) process.stdout.write(pc.dim(`  profile:  `) + pc.cyan(profile) + '\n');
  process.stdout.write('\n');

  const { startScheduler } = await import('../scheduler.js');

  const shutdown = (signal) => {
    process.stdout.write('\n' + pc.dim(`  received ${signal}, exiting...`) + '\n');
    process.exit(0);
  };
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await startScheduler(process.argv);
    // startScheduler kicks off a setInterval; keep the process alive.
    await new Promise(() => {});
  } catch (err) {
    process.stderr.write('\n' + pc.red(`  Scheduler crashed: ${err.message}`) + '\n');
    process.stderr.write(pc.dim(err.stack || '') + '\n');
    process.exit(1);
  }
}
