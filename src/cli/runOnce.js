import 'dotenv/config';
import pc from 'picocolors';
import { buildConfig } from '../config.js';
import { appendLog } from '../logger.js';
import { runJobHunt } from '../pipeline.js';

/**
 * `jobpilot run [--profile=<name>] [--max-jobs=N] [--max-applies=N] [--sites=a,b]`
 * Single foreground pass.
 *
 * Flags:
 *   --profile=<name>       target a specific profile (defaults to env PROFILE)
 *   --max-jobs=N           cap jobs processed this run (overrides preferences.json)
 *   --max-applies=N        cap auto-applies this run (overrides preferences.json)
 *   --sites=a,b            limit enabled sites for this run
 *   --no-apply             alias for --max-applies=0; scrape + score, never apply
 *   --reprocess-non-applied re-evaluate processed jobs except confirmed applications
 *   --allow-gateway-submit allow source boards to hand off to audited apply adapters
 */
export async function cmdRun(args = {}) {
  const argv = [process.argv[0], 'jobpilot'];
  const profile = args.profile || args.p || process.env.PROFILE;
  if (profile) argv.push(`--profile=${profile}`);

  // Surface caps as per-profile env overrides so buildConfig picks them up.
  const maxJobs = numericArg(args, ['max-jobs', 'maxJobs']);
  const noApply = args['no-apply'] === true || args.noApply === true;
  const reprocessNonApplied = args['reprocess-non-applied'] === true || args.reprocessNonApplied === true;
  const allowGatewaySubmit = args['allow-gateway-submit'] === true || args.allowGatewaySubmit === true;
  const maxApplies = noApply ? 0 : numericArg(args, ['max-applies', 'maxApplies']);
  const sites = csvArg(args, ['sites', 'site']);
  const upper = profile ? profile.toUpperCase().replace(/[^A-Z0-9]+/g, '_') : '';

  if (profile && (maxJobs !== null || maxApplies !== null)) {
    if (maxJobs !== null) process.env[`${upper}_MAX_JOBS_PER_RUN`] = String(maxJobs);
    if (maxApplies !== null) process.env[`${upper}_MAX_AUTO_APPLY_PER_RUN`] = String(maxApplies);
  } else {
    if (maxJobs !== null) process.env.MAX_JOBS_PER_RUN = String(maxJobs);
    if (maxApplies !== null) process.env.MAX_AUTO_APPLY_PER_RUN = String(maxApplies);
  }
  if (maxJobs !== null && process.env.SCRAPER_LIMIT === undefined) {
    process.env.SCRAPER_LIMIT = String(maxJobs);
  }
  if (sites) {
    process.env.ENABLED_SITES = sites;
    if (upper) process.env[`${upper}_ENABLED_SITES`] = sites;
  }
  if (allowGatewaySubmit) {
    process.env.ALLOW_GATEWAY_AUTO_SUBMIT = 'true';
    if (upper) process.env[`${upper}_ALLOW_GATEWAY_AUTO_SUBMIT`] = 'true';
  }

  const config = buildConfig(argv);
  const label = config.profileName ? pc.cyan(config.profileName) : pc.dim('(default)');

  console.log();
  console.log(`  ${pc.bold('JobPilot')} ${pc.dim('-')} run pass for ${label}`);
  console.log(`  ${pc.dim('sites:')}        ${pc.white(config.enabledSites.join(',') || '(none)')}`);
  if (config.testMode) console.log(`  ${pc.yellow('TEST_MODE')}      ${pc.dim('- no real submissions')}`);
  if (noApply || maxApplies === 0) console.log(`  ${pc.yellow('NO-APPLY')}       ${pc.dim('- scoring only, no submissions this run')}`);
  if (maxJobs !== null) console.log(`  ${pc.dim('max-jobs:')}     ${pc.white(maxJobs)}`);
  if (maxApplies !== null) console.log(`  ${pc.dim('max-applies:')}  ${pc.white(maxApplies)}`);
  if (sites) console.log(`  ${pc.dim('sites:')}        ${pc.white(sites)}`);
  if (config.allowGatewayAutoSubmit) console.log(`  ${pc.dim('gateway:')}      ${pc.white('audited handoff enabled')}`);
  if (reprocessNonApplied) console.log(`  ${pc.dim('reprocess:')}    ${pc.white('non-applied records only')}`);
  console.log();

  const start = Date.now();
  try {
    const results = await runJobHunt(config, { reprocessNonApplied });
    const summary = summarizeResults(results, results.runSummary);
    const took = ((Date.now() - start) / 1000).toFixed(1);

    console.log();
    console.log(`  ${pc.bold('Done')} ${pc.dim(`in ${took}s`)}`);
    const lines = [
      ['Scraped', summary.scraped],
      ['Ignored', summary.ignored],
      ['Queued review', summary.queuedReview],
      ['Apply attempts', summary.autoApplyAttempts],
      ['Auto-applied', summary.autoApplied],
      ['Deduped', summary.deduped],
      ['Errors', summary.errors]
    ];
    for (const [key, value] of lines) {
      console.log(`    ${pc.dim(key.padEnd(14))}${pc.white(String(value))}`);
    }

    console.log();
    console.log(pc.dim('  jobpilot status     see profile rollup'));
    console.log(pc.dim('  jobpilot review     walk the queue'));
    console.log();
  } catch (err) {
    await appendLog(`cmdRun fatal: ${err.stack || err.message}`, config);
    console.error();
    console.error(pc.red(`  Run failed: ${err.message}`));
    console.error(pc.dim('  See logs/<profile>.log or run: jobpilot doctor'));
    console.error();
    process.exitCode = 1;
  }
}

export function summarizeResults(results, runSummary = {}) {
  const rows = Array.isArray(results) ? results : [];
  const newRows = rows.filter((row) => !row.deduped && row.status !== 'duplicate' && row.decision !== 'duplicate');
  return {
    scraped: runSummary.jobsScanned ?? rows.length,
    ignored: runSummary.jobsIgnored ?? newRows.filter((row) => row.decision === 'ignore' || row.status === 'skipped').length,
    queuedReview: runSummary.jobsQueuedForReview ?? newRows.filter((row) => row.status === 'pending' || row.status === 'manual_review').length,
    autoApplyAttempts: runSummary.jobsAutoApplyAttempts ?? newRows.filter((row) => row.decision === 'apply').length,
    autoApplied: runSummary.jobsAutoApplied ?? newRows.filter((row) => row.status === 'applied').length,
    deduped: runSummary.jobsDeduped ?? rows.filter((row) => row.deduped || row.status === 'duplicate' || row.decision === 'duplicate').length,
    errors: (runSummary.errors?.length || 0) + (runSummary.processingErrors ?? newRows.filter((row) => row.status === 'failed').length)
  };
}

function numericArg(args, names) {
  for (const name of names) {
    if (args[name] === undefined) continue;
    const value = parseInt(args[name], 10);
    if (!Number.isNaN(value) && value >= 0) return value;
  }
  return null;
}

function csvArg(args, names) {
  for (const name of names) {
    const value = args[name];
    if (value === undefined || value === true) continue;
    const cleaned = String(value)
      .split(',')
      .map((item) => item.trim().toLowerCase().replace(/[^a-z0-9]+/g, ''))
      .filter(Boolean)
      .join(',');
    if (cleaned) return cleaned;
  }
  return '';
}
