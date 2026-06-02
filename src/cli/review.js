import fs from 'node:fs/promises';
import path from 'node:path';
import pc from 'picocolors';
import { select, isCancel, cancel, intro, outro, confirm } from '@clack/prompts';

const ROOT = process.cwd();
const REVIEW_STATUSES = new Set(['reviewed', 'pending_apply', 'manual_review']);

/**
 * `jobpilot review [--profile=<name>]`
 * Walks the review queue. For each entry: show details, prompt
 * approve / skip / reject / open URL / quit.
 */
export async function cmdReview(args = {}) {
  const profilesDir = path.join(ROOT, 'profiles');
  const targetProfile = args.profile || args.p || null;

  let names = [];
  try {
    names = (await fs.readdir(profilesDir)).filter((n) => !n.startsWith('.') && n !== 'example');
  } catch {
    console.log(pc.yellow('  No profiles directory yet. Run: jobpilot init'));
    return;
  }
  if (targetProfile) names = names.filter((n) => n === targetProfile);
  if (names.length === 0) {
    console.log(pc.yellow('  No profiles to review.'));
    return;
  }

  intro(pc.bgCyan(pc.black(' Review queue ')));

  let totalReviewed = 0;
  let totalApproved = 0;
  let totalRejected = 0;

  for (const name of names) {
    const storePath = path.join(profilesDir, name, 'processedJobs.json');
    let store;
    try {
      store = JSON.parse(await fs.readFile(storePath, 'utf-8'));
    } catch {
      continue;
    }
    const jobs = (store.jobs || []).filter((j) => REVIEW_STATUSES.has(j.status));
    if (jobs.length === 0) {
      console.log(pc.dim(`  ${name}: nothing in queue`));
      continue;
    }

    console.log();
    console.log(pc.bold(pc.cyan(`  ${name}`)) + pc.dim(`  ·  ${jobs.length} pending`));

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      printJob(job, i + 1, jobs.length);

      const action = await select({
        message: 'What now?',
        options: [
          { value: 'approve', label: pc.green('Approve  → mark pending_apply') },
          { value: 'reject',  label: pc.red('Reject   → mark ignored') },
          { value: 'skip',    label: 'Skip     → leave for later' },
          { value: 'open',    label: 'Open URL in browser' },
          { value: 'quit',    label: pc.dim('Quit review') }
        ]
      });

      if (isCancel(action) || action === 'quit') {
        await saveStore(storePath, store);
        outro(pc.dim(`  reviewed ${totalReviewed}, approved ${totalApproved}, rejected ${totalRejected}`));
        return;
      }

      if (action === 'open') {
        await openUrl(job.url);
        i--; // re-prompt this job
        continue;
      }

      const target = findJobIndex(store.jobs, job);
      if (target === -1) continue;

      if (action === 'approve') {
        store.jobs[target].status    = 'pending_apply';
        store.jobs[target].updatedAt = new Date().toISOString();
        totalApproved += 1;
      } else if (action === 'reject') {
        store.jobs[target].status    = 'ignored';
        store.jobs[target].updatedAt = new Date().toISOString();
        store.jobs[target].rejectedAt = store.jobs[target].updatedAt;
        store.jobs[target].rejectedReason = 'manual review';
        totalRejected += 1;
      }
      totalReviewed += 1;
    }

    await saveStore(storePath, store);
  }

  console.log();
  if (totalReviewed === 0) {
    outro(pc.dim('  Nothing to review.'));
  } else {
    outro(
      pc.dim(`  reviewed ${totalReviewed}  ·  `) +
      pc.green(`approved ${totalApproved}`) + pc.dim('  ·  ') +
      pc.red(`rejected ${totalRejected}`)
    );
    console.log(pc.dim('  Run:  ') + pc.cyan('jobpilot run') + pc.dim('   to submit the approved jobs.'));
  }
}

function printJob(job, idx, total) {
  console.log();
  console.log(pc.dim(`  [${idx}/${total}]`));
  console.log(`  ${pc.bold(job.title || '(untitled)')}`);
  console.log(`  ${pc.dim('company:')} ${job.company || '—'}`);
  console.log(`  ${pc.dim('site:   ')} ${job.source || job.site || '—'}`);
  if (job.score !== undefined) {
    const s = Number(job.score) || 0;
    const color = s >= 70 ? pc.green : s >= 50 ? pc.yellow : pc.dim;
    console.log(`  ${pc.dim('score:  ')} ${color(String(s))}`);
  }
  if (job.url) console.log(`  ${pc.dim('url:    ')} ${pc.cyan(job.url)}`);
  if (job.summary)         console.log(`  ${pc.dim('summary:')} ${truncate(job.summary, 240)}`);
  else if (job.description) console.log(`  ${pc.dim('summary:')} ${truncate(job.description, 240)}`);
  if (Array.isArray(job.matchReasons) && job.matchReasons.length) {
    console.log(`  ${pc.dim('reasons:')}`);
    for (const r of job.matchReasons.slice(0, 3)) console.log(`    · ${r}`);
  }
}

function findJobIndex(jobs, target) {
  return jobs.findIndex((j) =>
    (target.url && j.url === target.url) ||
    (target.title === j.title && target.company === j.company && target.source === j.source)
  );
}

async function saveStore(storePath, store) {
  await fs.writeFile(storePath, JSON.stringify(store, null, 2), 'utf-8');
}

function truncate(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

async function openUrl(url) {
  if (!url) return;
  try {
    const { exec } = await import('node:child_process');
    const cmd = process.platform === 'win32' ? 'start "" '
              : process.platform === 'darwin' ? 'open '
              : 'xdg-open ';
    exec(cmd + JSON.stringify(url), { windowsHide: true });
  } catch { /* user opens manually */ }
}
