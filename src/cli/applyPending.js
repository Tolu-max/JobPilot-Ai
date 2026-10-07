import pc from 'picocolors';
import { buildConfig } from '../config.js';
import { loadJobStore } from '../jobStore.js';
import { flushPendingApplyQueue } from '../pipeline.js';

export async function cmdApplyPending(args = {}) {
  const argv = [process.argv[0], 'jobpilot'];
  const profile = args.profile || args.p || process.env.PROFILE;
  if (profile) argv.push(`--profile=${profile}`);

  const config = buildConfig(argv);
  const before = await countPending(config);

  console.log();
  console.log(`  ${pc.bold('JobPilot')} ${pc.dim('-')} apply pending jobs for ${pc.cyan(config.profileName)}`);
  if (config.testMode) console.log(`  ${pc.yellow('TEST_MODE')} ${pc.dim('- no real submissions')}`);
  console.log(`  ${pc.dim('pending_apply:')} ${pc.white(String(before))}`);
  console.log();

  await flushPendingApplyQueue(config);

  const after = await countPending(config);
  console.log(`  ${pc.dim('remaining:')} ${pc.white(String(after))}`);
  console.log();
}

async function countPending(config) {
  const store = await loadJobStore(config);
  return (store.jobs || []).filter((job) => job.status === 'pending_apply').length;
}
