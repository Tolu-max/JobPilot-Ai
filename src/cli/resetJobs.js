import pc from 'picocolors';
import { buildConfig } from '../config.js';
import { resetProcessedJobs } from '../jobStore.js';

export async function cmdResetJobs(args = {}) {
  const argv = [process.argv[0], 'jobpilot'];
  const profile = args.profile || args.p || process.env.PROFILE;
  if (profile) argv.push(`--profile=${profile}`);

  const config = buildConfig(argv);
  const allNonApplied = args.allNonApplied === true || args['all-non-applied'] === true || args.all === true;
  const dryRun = args.dryRun === true || args['dry-run'] === true;

  const label = config.profileName ? pc.cyan(config.profileName) : pc.dim('(default)');
  console.log();
  console.log(`  ${pc.bold('JobPilot')} ${pc.dim('-')} reset processed jobs for ${label}`);
  console.log(`  ${pc.dim('mode:')} ${pc.white(allNonApplied ? 'all non-applied' : 'retryable only')}`);
  if (dryRun) console.log(`  ${pc.yellow('DRY RUN')} ${pc.dim('- no files changed')}`);
  console.log();

  if (dryRun) {
    const { loadJobStore } = await import('../jobStore.js');
    const store = await loadJobStore(config);
    const jobs = Array.isArray(store.jobs) ? store.jobs : [];
    const removable = jobs.filter((record) => record.status !== 'applied' && (allNonApplied || ['ignored', 'reviewed', 'failed', 'manual_review'].includes(record.status)));
    console.log(`  ${pc.dim('processed:')} ${pc.white(String(jobs.length))}`);
    console.log(`  ${pc.dim('would reset:')} ${pc.white(String(removable.length))}`);
    console.log(`  ${pc.dim('would keep:')} ${pc.white(String(jobs.length - removable.length))}`);
    console.log();
    return;
  }

  const result = await resetProcessedJobs(config, { allNonApplied });
  console.log(`  ${pc.dim('before:')}  ${pc.white(String(result.before))}`);
  console.log(`  ${pc.dim('removed:')} ${pc.yellow(String(result.removed))}`);
  console.log(`  ${pc.dim('kept:')}    ${pc.white(String(result.kept))}`);
  console.log();
  console.log(pc.dim(`  Next: jobpilot run --profile=${config.profileName}`));
  console.log();
}
