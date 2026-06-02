import pc from 'picocolors';
import { readMetrics, readAiSpend, formatRelative, formatRelativeFuture } from './metrics.js';

const STATUS_DOT = {
  applied:        pc.green('●'),
  reviewed:       pc.yellow('●'),
  pending_apply:  pc.yellow('●'),
  manual_review:  pc.yellow('●'),
  failed:         pc.red('●'),
  ignored:        pc.gray('·')
};

/**
 * `jobpilot status` — rich one-shot snapshot.
 * Designed for SSH-friendly read; no animations, no alt-screen.
 */
export async function cmdSnapshot(args = {}) {
  const metrics = await readMetrics();
  const ai      = await readAiSpend();
  const targetProfile = args.profile || args.p || null;

  if (metrics.totals.profiles === 0) {
    console.log();
    console.log(pc.yellow('  No profiles configured.'));
    console.log(pc.dim('  Run:  ') + pc.cyan('jobpilot init'));
    console.log();
    return;
  }

  const now = Date.now();
  console.log();
  console.log(pc.bold(pc.cyan('  JobPilot')) + pc.dim(`  ·  ${metrics.totals.profiles} profile${metrics.totals.profiles === 1 ? '' : 's'}`));
  console.log(pc.dim('  ────────────────────────────────────'));
  console.log(`  Last run     ${pc.white(formatRelative(metrics.lastRunAt, now))}`);
  console.log(`  Next run     ${pc.white(formatRelativeFuture(metrics.nextRunAt, now))}`);
  console.log(`  Applies/24h  ${pc.green(metrics.totals.applied24h)}`);
  console.log(`  Review queue ${pc.yellow(metrics.totals.reviewQueue)} pending`);
  if (ai) {
    console.log(`  AI calls     ${pc.white(ai.calls)}  ${pc.dim(`(~$${ai.estimatedUsd})`)}`);
  }
  console.log();

  console.log(pc.bold('  By profile:'));
  const colW = Math.max(...metrics.perProfile.map((p) => p.name.length), 8);
  for (const p of metrics.perProfile) {
    if (targetProfile && p.name !== targetProfile) continue;
    const flag = p.autoApply ? pc.green('auto-apply on') : pc.dim('auto-apply off');
    console.log(
      `    ${p.name.padEnd(colW)}  ` +
      `${pc.green(`${p.applied24h} applied/24h`)}  ` +
      `${pc.yellow(`${p.reviewQueue} queued`)}  ` +
      `${pc.dim(`${p.appliedAllTime} all-time`)}  ` +
      `${flag}`
    );
  }
  console.log();

  if (metrics.recentActivity.length > 0) {
    const activity = targetProfile
      ? metrics.recentActivity.filter((a) => a.profile === targetProfile)
      : metrics.recentActivity;
    if (activity.length > 0) {
      console.log(pc.bold('  Recent activity:'));
      for (const a of activity.slice(0, 6)) {
        const dot = STATUS_DOT[a.status] || pc.dim('·');
        const title = a.title.length > 40 ? a.title.slice(0, 39) + '…' : a.title;
        console.log(
          `    ${dot}  ${pc.dim(a.time)}  ${pc.cyan(a.profile.padEnd(8))}  ${pc.dim(a.site.padEnd(10))}  ${title}`
        );
      }
      console.log();
    }
  }

  console.log(pc.dim('  jobpilot run        run one pass now'));
  console.log(pc.dim('  jobpilot dashboard  live dashboard'));
  console.log(pc.dim('  jobpilot review     walk the queue'));
  console.log();
}
